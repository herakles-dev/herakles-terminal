/**
 * TeamFileWatcher - Watch Claude Code's ~/.claude/teams/ and ~/.claude/tasks/ directories
 *
 * Monitors team config files and task directories for changes, emitting events
 * when teams are detected, dissolved, or member states change.
 *
 * Pattern follows TodoFileWatcher:
 * - fs.watch on directories
 * - Debounced processing
 * - EventEmitter for TeamManager integration
 */

import { EventEmitter } from 'events';
import { watch, existsSync, readdirSync, statSync, readFileSync, writeFileSync, FSWatcher } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import type { TeamInfo, TeamMember } from '../../shared/teamProtocol.js';
import { getAgentColor } from '../../shared/teamProtocol.js';

const CLAUDE_TEAMS_DIR = join(homedir(), '.claude', 'teams');
const CLAUDE_TASKS_DIR = join(homedir(), '.claude', 'tasks');
const DEBOUNCE_MS = 200;

export interface TeamFileEvent {
  teams: TeamInfo[];
}

interface RawTeamMember {
  name: string;
  agentId: string;
  agentType?: string;
  model?: string;
  tmuxPaneId?: string;
  backendType?: string;
  cwd?: string;
}

interface RawTeamConfig {
  team_name?: string;
  description?: string;
  tmux_socket?: string;
  members?: RawTeamMember[];
}

interface RawTaskFile {
  id?: string;
  subject?: string;
  status?: string;
  owner?: string;
}

export class TeamFileWatcher extends EventEmitter {
  private teamsWatcher: FSWatcher | null = null;
  private teamDirWatchers: Map<string, FSWatcher> = new Map();
  private taskDirWatchers: Map<string, FSWatcher> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private cachedTeams: TeamInfo[] = [];
  private watcherLogger = logger.child({ component: 'team-watcher' });

  constructor() {
    super();
  }

  /**
   * Start watching for Claude Code teams
   */
  start(): void {
    if (this.teamsWatcher) {
      // Idempotent: start() is called on every subscribe by design. Not a warning.
      this.watcherLogger.debug('TeamFileWatcher already running — no-op');
      return;
    }

    // Watch teams directory
    if (existsSync(CLAUDE_TEAMS_DIR)) {
      try {
        this.teamsWatcher = watch(CLAUDE_TEAMS_DIR, { persistent: false }, (_event, filename) => {
          // Fast-path: patch "inherit" models before agent process reads config
          if (filename) {
            const teamDir = join(CLAUDE_TEAMS_DIR, filename);
            if (existsSync(teamDir) && statSync(teamDir).isDirectory()) {
              this.fastPatchInheritModels(teamDir);
            }
          }
          this.scheduleRefresh();
        });
        this.teamsWatcher.on('error', (err) => {
          this.watcherLogger.error('Teams directory watcher error:', { error: (err as Error).message });
        });
        this.watcherLogger.info(`Watching teams directory: ${CLAUDE_TEAMS_DIR}`);
      } catch (err) {
        this.watcherLogger.warn('Failed to watch teams directory:', { error: (err as Error).message });
      }
    } else {
      this.watcherLogger.info('Teams directory does not exist yet, will check periodically');
    }

    // NOTE: Do NOT watch ~/.claude/tasks/ root — it contains 100s of UUID dirs
    // from all Claude sessions. Instead, watch per-team task dirs in processAllTeams().

    // Periodic poll fallback — fs.watch on Linux misses some nested directory events
    this.pollTimer = setInterval(() => {
      this.processAllTeams();
    }, 10_000);

    // Initial scan
    this.processAllTeams();
  }

  /**
   * Stop all watchers
   */
  stop(): void {
    if (this.teamsWatcher) {
      this.teamsWatcher.close();
      this.teamsWatcher = null;
    }
    for (const watcher of this.teamDirWatchers.values()) {
      watcher.close();
    }
    this.teamDirWatchers.clear();
    for (const watcher of this.taskDirWatchers.values()) {
      watcher.close();
    }
    this.taskDirWatchers.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Fast-path synchronous patcher: patches "inherit" models with zero debounce.
   * Runs synchronously to beat the agent process to the file read (~10ms vs ~100-300ms startup).
   */
  private fastPatchInheritModels(teamDir: string): void {
    const configPath = join(teamDir, 'config.json');
    try {
      if (!existsSync(configPath)) return;

      const raw = readFileSync(configPath, 'utf-8');

      // Quick string check before parsing — skip if no "inherit" present
      if (!raw.includes('"inherit"')) return;

      const config = JSON.parse(raw);
      const members = config.members;
      if (!Array.isArray(members) || members.length === 0) return;

      const leadModel = members.find((m: RawTeamMember) => m.model && m.model !== 'inherit')?.model;
      if (!leadModel) return;

      let patched = false;
      for (const member of members) {
        if (member.model === 'inherit') {
          member.model = leadModel;
          patched = true;
        }
      }

      if (patched) {
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        this.watcherLogger.info(`[fast-patch] Resolved "inherit" → ${leadModel} in ${configPath}`);
      }
    } catch (err) {
      // Non-fatal: the async resolveInheritModels will retry
      this.watcherLogger.debug('Fast-patch failed (will retry async):', { error: (err as Error).message });
    }
  }

  /**
   * Schedule a debounced refresh
   */
  private scheduleRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processAllTeams();
    }, DEBOUNCE_MS);
  }

  /**
   * Force an immediate refresh
   */
  refresh(): void {
    this.processAllTeams();
  }

  /**
   * Get cached team state
   */
  getCurrentTeams(): TeamInfo[] {
    return this.cachedTeams;
  }

  /**
   * Scan all team directories and build team state
   */
  private async processAllTeams(): Promise<void> {
    const teams: TeamInfo[] = [];

    if (!existsSync(CLAUDE_TEAMS_DIR)) {
      if (this.cachedTeams.length > 0) {
        this.cachedTeams = [];
        this.emit('teams', { teams: [] } as TeamFileEvent);
      }
      return;
    }

    try {
      const entries = readdirSync(CLAUDE_TEAMS_DIR);

      for (const entry of entries) {
        const teamDir = join(CLAUDE_TEAMS_DIR, entry);
        try {
          const stat = statSync(teamDir);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }

        const configPath = join(teamDir, 'config.json');
        if (!existsSync(configPath)) continue;

        try {
          const configData = await readFile(configPath, 'utf-8');
          const config: RawTeamConfig = JSON.parse(configData);
          const teamName = config.team_name || entry;

          // Resolve "inherit" model values to the team lead's actual model
          await this.resolveInheritModels(configPath, config);

          // Watch individual team directory for config changes
          if (!this.teamDirWatchers.has(entry)) {
            try {
              const dirWatcher = watch(teamDir, { persistent: false }, (_event, filename) => {
                // Fast-path: patch "inherit" on any config.json change (agent added)
                if (!filename || filename === 'config.json') {
                  this.fastPatchInheritModels(teamDir);
                }
                this.scheduleRefresh();
              });
              this.teamDirWatchers.set(entry, dirWatcher);
            } catch {
              // Ignore watch errors on individual dirs
            }
          }

          // Watch per-team task directory (NOT the root tasks dir)
          const teamTasksDir = join(CLAUDE_TASKS_DIR, entry);
          if (existsSync(teamTasksDir) && !this.taskDirWatchers.has(entry)) {
            try {
              const taskWatcher = watch(teamTasksDir, { persistent: false }, () => {
                this.scheduleRefresh();
              });
              taskWatcher.on('error', () => {}); // Silently handle
              this.taskDirWatchers.set(entry, taskWatcher);
            } catch {
              // Ignore watch errors
            }
          }

          // Load task state for this team
          const taskCounts = await this.loadTaskCounts(entry);
          const memberTasks = await this.loadMemberTasks(entry);

          // Build team members with status
          const members: TeamMember[] = (config.members || []).map((m, idx) => {
            const task = memberTasks.get(m.name);
            let status: TeamMember['status'] = 'idle';
            let currentTask: string | undefined;

            if (task) {
              if (task.status === 'in_progress') {
                status = 'working';
                currentTask = task.subject;
              } else if (task.status === 'completed') {
                status = 'completed';
              }
            }

            return {
              name: m.name,
              agentId: m.agentId,
              agentType: m.agentType || 'general-purpose',
              status,
              currentTask,
              color: getAgentColor(idx),
            };
          });

          const configStat = statSync(configPath);

          teams.push({
            name: teamName,
            description: config.description,
            members,
            taskCounts,
            lastModified: configStat.mtimeMs,
          });
        } catch (err) {
          this.watcherLogger.warn(`Failed to parse team config: ${entry}`, {
            error: (err as Error).message,
          });
        }
      }
    } catch (err) {
      this.watcherLogger.error('Failed to scan teams directory:', {
        error: (err as Error).message,
      });
    }

    // Clean up watchers for removed teams
    const activeTeamDirs = new Set(
      readdirSync(CLAUDE_TEAMS_DIR).filter(e => {
        try { return statSync(join(CLAUDE_TEAMS_DIR, e)).isDirectory(); } catch { return false; }
      })
    );
    for (const [dir, watcher] of this.teamDirWatchers) {
      if (!activeTeamDirs.has(dir)) {
        watcher.close();
        this.teamDirWatchers.delete(dir);
      }
    }
    for (const [dir, watcher] of this.taskDirWatchers) {
      if (!activeTeamDirs.has(dir)) {
        watcher.close();
        this.taskDirWatchers.delete(dir);
      }
    }

    this.cachedTeams = teams;
    this.emit('teams', { teams } as TeamFileEvent);
  }

  /**
   * Resolve "inherit" model values in team config.
   * Claude Code's Agent tool writes "model": "inherit" for spawned teammates,
   * but the child process reads it as a literal model ID and fails.
   * Fix: replace "inherit" with the team lead's resolved model.
   */
  private async resolveInheritModels(configPath: string, config: RawTeamConfig): Promise<void> {
    const members = config.members;
    if (!members || members.length === 0) return;

    // Find the team lead's model (first member with a non-"inherit" model)
    const leadModel = members.find(m => m.model && m.model !== 'inherit')?.model;
    if (!leadModel) return;

    const needsFix = members.some(m => m.model === 'inherit');
    if (!needsFix) return;

    // Rewrite config with resolved models
    for (const member of members) {
      if (member.model === 'inherit') {
        member.model = leadModel;
      }
    }

    try {
      // Re-read to get the full raw JSON (config may have fields we don't model in RawTeamConfig)
      const rawData = await readFile(configPath, 'utf-8');
      const fullConfig = JSON.parse(rawData);

      for (const member of fullConfig.members || []) {
        if (member.model === 'inherit') {
          member.model = leadModel;
        }
      }

      await writeFile(configPath, JSON.stringify(fullConfig, null, 2) + '\n', 'utf-8');
      this.watcherLogger.info(`Resolved "inherit" models → ${leadModel} in ${configPath}`);
    } catch (err) {
      this.watcherLogger.warn('Failed to resolve inherit models:', { error: (err as Error).message });
    }
  }

  /**
   * Load task counts for a team from ~/.claude/tasks/{team}/
   */
  private async loadTaskCounts(teamName: string): Promise<TeamInfo['taskCounts']> {
    const counts = { total: 0, completed: 0, inProgress: 0, pending: 0 };
    const tasksDir = join(CLAUDE_TASKS_DIR, teamName);

    if (!existsSync(tasksDir)) return counts;

    try {
      const files = readdirSync(tasksDir).filter(f => f.endsWith('.json'));
      counts.total = files.length;

      for (const file of files) {
        try {
          const data = await readFile(join(tasksDir, file), 'utf-8');
          const task: RawTaskFile = JSON.parse(data);
          if (task.status === 'completed') counts.completed++;
          else if (task.status === 'in_progress') counts.inProgress++;
          else counts.pending++;
        } catch {
          // Ignore malformed task files
        }
      }
    } catch {
      // Tasks dir may not be readable
    }

    return counts;
  }

  /**
   * Load member-to-task mapping for status display
   */
  private async loadMemberTasks(teamName: string): Promise<Map<string, { subject: string; status: string }>> {
    const memberTasks = new Map<string, { subject: string; status: string }>();
    const tasksDir = join(CLAUDE_TASKS_DIR, teamName);

    if (!existsSync(tasksDir)) return memberTasks;

    try {
      const files = readdirSync(tasksDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        try {
          const data = await readFile(join(tasksDir, file), 'utf-8');
          const task: RawTaskFile = JSON.parse(data);
          if (task.owner && task.status === 'in_progress') {
            memberTasks.set(task.owner, {
              subject: task.subject || 'Working...',
              status: task.status,
            });
          }
        } catch {
          // Ignore malformed task files
        }
      }
    } catch {
      // Tasks dir may not be readable
    }

    return memberTasks;
  }
}

/** Singleton instance */
export const teamFileWatcher = new TeamFileWatcher();
