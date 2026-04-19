/**
 * Resolves a Zeus window → the Claude Code JSONL session file it is writing to.
 *
 * Each `claude` invocation appends to a single `~/.claude/projects/<proj>/<uuid>.jsonl`
 * file. Multiple Zeus windows in the same project create SEPARATE JSONL files.
 *
 * Claude writes to the session JSONL transactionally (open → write → close per
 * turn), so `/proc/<claude_pid>/fd/` rarely has an open handle to the file. We
 * therefore combine two strategies:
 *
 *   PRIMARY — open-fd scan with retries (catches the brief moment during a
 *   write). Cheap and exact when it works.
 *
 *   FALLBACK — use `/proc/<claude_pid>/cwd` to derive the project directory,
 *   then pick the most recently modified JSONL in `~/.claude/projects/<encoded>`
 *   that isn't already reserved by another window. Good-enough for the common
 *   single-claude-per-project case and for multi-claude when we time-order
 *   correctly via the `reserved` set.
 *
 * Best-effort: if any step fails (Linux-only, permissions, no claude running,
 * stale tmux state) we return null. Callers should tolerate null and rely on
 * the periodic retry ticker in ContextManager to reconcile later.
 */

import { readdir, readlink, readFile, stat } from 'fs/promises';
import { readdirSync, statSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { basename, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import type { TmuxManager } from '../tmux/TmuxManager.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const JSONL_RECENCY_MS = 30 * 60 * 1000;  // JSONL considered "active" if mtime within 30 min
const FD_SCAN_RETRIES = 3;
const FD_SCAN_RETRY_DELAY_MS = 40;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const execAsync = promisify(exec);

// Cache entry: windowId → { sessionId, resolvedAt }
interface CacheEntry {
  sessionId: string | null;
  resolvedAt: number;
}

const TTL_MS = 10_000; // re-check at most once per 10s per window
const cache = new Map<string, CacheEntry>();

async function getPanePid(_tmux: TmuxManager, sessionId: string): Promise<number | null> {
  // Socket path and session-name format must match TmuxManager's conventions:
  //   socket: /tmp/zeus-tmux/<sessionId>
  //   name:   zeus-<sessionId>
  const socketPath = `/tmp/zeus-tmux/${sessionId}`;
  const sessionName = `zeus-${sessionId}`;
  try {
    const { stdout } = await execAsync(
      `tmux -S "${socketPath}" display-message -p -t "${sessionName}" "#{pane_pid}"`,
      { timeout: 1500 },
    );
    const pid = parseInt(stdout.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function readProcComm(pid: number): Promise<string | null> {
  try {
    const comm = await readFile(`/proc/${pid}/comm`, 'utf-8');
    return comm.trim();
  } catch {
    return null;
  }
}

async function readProcChildren(pid: number): Promise<number[]> {
  // /proc/<pid>/task/<tid>/children is space-separated PIDs
  try {
    const taskDir = `/proc/${pid}/task`;
    const tids = await readdir(taskDir);
    const children: number[] = [];
    for (const tid of tids) {
      try {
        const data = await readFile(`${taskDir}/${tid}/children`, 'utf-8');
        for (const tok of data.trim().split(/\s+/)) {
          if (!tok) continue;
          const n = parseInt(tok, 10);
          if (Number.isFinite(n) && n > 0) children.push(n);
        }
      } catch {
        // skip
      }
    }
    return [...new Set(children)];
  } catch {
    return [];
  }
}

async function findClaudeDescendant(rootPid: number, maxDepth = 6): Promise<number | null> {
  // BFS down the process tree looking for a process named `claude` (or `node`
  // running `@anthropic-ai/claude-code`). We prioritise direct `claude` comm.
  const queue: { pid: number; depth: number }[] = [{ pid: rootPid, depth: 0 }];
  const seen = new Set<number>();

  while (queue.length > 0) {
    const { pid, depth } = queue.shift()!;
    if (seen.has(pid) || depth > maxDepth) continue;
    seen.add(pid);

    const comm = await readProcComm(pid);
    if (comm === 'claude' || comm === 'node') {
      // node might be claude-code CLI — verify by checking open jsonl handles below.
      // But direct 'claude' match is fine to return immediately.
      if (comm === 'claude') return pid;
      // For node, check if it has an open .jsonl in ~/.claude/projects
      const fd = await findOpenJsonl(pid);
      if (fd) return pid;
    }

    if (depth < maxDepth) {
      const children = await readProcChildren(pid);
      for (const c of children) queue.push({ pid: c, depth: depth + 1 });
    }
  }
  return null;
}

async function findOpenJsonl(pid: number): Promise<string | null> {
  try {
    const fdDir = `/proc/${pid}/fd`;
    const fds = await readdir(fdDir);
    for (const fd of fds) {
      try {
        const target = await readlink(`${fdDir}/${fd}`);
        if (target.endsWith('.jsonl') && target.includes('/.claude/projects/')) {
          return target;
        }
      } catch {
        // skip unreadable fd
      }
    }
  } catch {
    // /proc not accessible (non-Linux or permission)
  }
  return null;
}

async function readProcCwd(pid: number): Promise<string | null> {
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/** Convert an absolute path into Claude's encoded project directory name. */
function encodeProjectDirName(absPath: string): string {
  // "/home/hercules/herakles-terminal" → "-home-hercules-herakles-terminal"
  return absPath.replace(/\//g, '-');
}

/**
 * Fallback: list recent JSONL files in the Claude project directory
 * corresponding to `cwd`, return the newest one not already reserved.
 * Returns null if no candidate exists (no project dir, no recent files, or
 * every recent file is reserved by another window).
 */
function findNewestUnreservedJsonlForCwd(
  cwd: string,
  reserved: Set<string>,
): string | null {
  const projectDirName = encodeProjectDirName(cwd);
  const projectDir = join(CLAUDE_PROJECTS_DIR, projectDirName);
  let files: string[];
  try {
    files = readdirSync(projectDir);
  } catch {
    return null;
  }

  const now = Date.now();
  const candidates: { sessionId: string; mtimeMs: number }[] = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const sid = basename(f, '.jsonl');
    if (reserved.has(sid)) continue;
    try {
      const s = statSync(join(projectDir, f));
      if ((now - s.mtimeMs) > JSONL_RECENCY_MS) continue;
      candidates.push({ sessionId: sid, mtimeMs: s.mtimeMs });
    } catch {
      // skip
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  return candidates[0].sessionId;
}

/**
 * Resolve the JSONL session ID for a Zeus window.
 *
 * @param reserved  Session IDs already claimed by other windows. The fallback
 *                  path uses this to avoid collisions when multiple claudes
 *                  run in the same project.
 *
 * Returns null if we can't determine it (e.g., no claude running, non-Linux,
 * no recent JSONL in the claude's cwd project).
 */
export async function resolveWindowSession(
  windowId: string,
  tmux: TmuxManager,
  reserved: Set<string> = new Set(),
): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(windowId);
  // Treat a cached non-null as authoritative for TTL. Treat a cached null as
  // short-lived — retry more eagerly because the cwd-fallback path is very
  // cheap and the user may have just started `claude`.
  if (cached && cached.sessionId !== null && (now - cached.resolvedAt) < TTL_MS) {
    return cached.sessionId;
  }
  if (cached && cached.sessionId === null && (now - cached.resolvedAt) < 2_000) {
    return null;
  }

  let sessionId: string | null = null;
  let panePid: number | null = null;
  let claudePid: number | null = null;
  let jsonlPath: string | null = null;
  let claudeCwd: string | null = null;
  let resolutionMethod: 'fd' | 'cwd-fallback' | 'none' = 'none';
  try {
    panePid = await getPanePid(tmux, windowId);
    if (panePid !== null) {
      claudePid = await findClaudeDescendant(panePid);
      if (claudePid !== null) {
        // PRIMARY: scan /proc/<claude_pid>/fd/ a few times — claude opens the
        // JSONL only briefly per turn, so we may need to catch it mid-write.
        for (let i = 0; i < FD_SCAN_RETRIES && !jsonlPath; i++) {
          jsonlPath = await findOpenJsonl(claudePid);
          if (!jsonlPath && i < FD_SCAN_RETRIES - 1) {
            await sleep(FD_SCAN_RETRY_DELAY_MS);
          }
        }
        if (jsonlPath) {
          sessionId = basename(jsonlPath, '.jsonl');
          resolutionMethod = 'fd';
        } else {
          // FALLBACK: use /proc/<claude_pid>/cwd to find the project dir,
          // then pick the newest unreserved JSONL in it.
          claudeCwd = await readProcCwd(claudePid);
          if (claudeCwd) {
            const candidate = findNewestUnreservedJsonlForCwd(claudeCwd, reserved);
            if (candidate) {
              sessionId = candidate;
              resolutionMethod = 'cwd-fallback';
            }
          }
        }
      }
    }
  } catch (err) {
    logger.debug(`sessionResolver: failed for ${windowId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info(`sessionResolver: windowId=${windowId}`, {
    panePid,
    claudePid,
    jsonlPath,
    claudeCwd,
    sessionId,
    method: resolutionMethod,
  });

  cache.set(windowId, { sessionId, resolvedAt: now });
  return sessionId;
}

/**
 * Force re-resolution on next call (e.g., after a claude process restarts).
 */
export function invalidateWindowSession(windowId: string): void {
  cache.delete(windowId);
}

/** Clear the whole cache (e.g., for tests). */
export function clearSessionResolverCache(): void {
  cache.clear();
}

/** Silence unused import warnings — `stat` reserved for future session-age heuristics. */
void stat;
