/**
 * Migration: Backfill auto_name for existing windows
 *
 * Queries each window's tmux session for its current working directory
 * and populates the auto_name field with the extracted project name.
 */

import type Database from 'better-sqlite3';
import { TmuxManager } from '../tmux/TmuxManager.js';
import { logger } from '../utils/logger.js';

interface WindowRow {
  id: string;
  auto_name: string | null;
}

/**
 * Extract project name from a working directory path.
 * Returns the directory name for paths under /home/hercules/, null otherwise.
 */
function extractProjectName(cwd: string | null): string | null {
  if (!cwd) return null;

  // Normalize home directory shorthand
  const normalizedPath = cwd.replace(/^~/, '/home/hercules');

  // Only extract project name from paths under /home/hercules/
  if (!normalizedPath.startsWith('/home/hercules/')) {
    return null;
  }

  // Remove /home/hercules/ prefix
  const relativePath = normalizedPath.substring('/home/hercules/'.length);

  // Extract the first directory component (project name)
  const parts = relativePath.split('/').filter(Boolean);
  return parts.length > 0 ? parts[0] : null;
}

/**
 * Run the migration to backfill auto_name for existing windows
 */
export async function migrateWindowAutoNames(db: Database.Database, tmux: TmuxManager): Promise<void> {
  const migrationKey = 'window_auto_names_v1';

  // Check if migration already ran
  try {
    const row = db
      .prepare('SELECT value FROM migrations WHERE key = ?')
      .get(migrationKey) as { value: string } | undefined;

    if (row) {
      logger.debug('Migration already completed: window_auto_names_v1');
      return;
    }
  } catch {
    // migrations table doesn't exist yet, create it
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        key TEXT PRIMARY KEY,
        completed_at INTEGER NOT NULL
      )
    `);
  }

  logger.info('Starting migration: backfill auto_name for existing windows');

  // Get all windows with NULL auto_name
  const windows = db
    .prepare('SELECT id, auto_name FROM windows WHERE auto_name IS NULL')
    .all() as WindowRow[];

  if (windows.length === 0) {
    logger.info('No windows to migrate');
    // Mark as completed anyway
    db.prepare('INSERT INTO migrations (key, completed_at) VALUES (?, ?)').run(
      migrationKey,
      Date.now()
    );
    return;
  }

  logger.info(`Found ${windows.length} windows to migrate`);

  const updateStmt = db.prepare('UPDATE windows SET auto_name = ? WHERE id = ?');
  let updated = 0;
  let skipped = 0;

  for (const window of windows) {
    try {
      // Check if tmux session exists
      const sessionExists = await tmux.sessionExists(window.id);
      if (!sessionExists) {
        logger.debug(`Skipping window ${window.id}: tmux session not found`);
        skipped++;
        continue;
      }

      // Get current working directory from tmux
      const cwd = await tmux.getCurrentWorkingDirectory(window.id);
      const projectName = extractProjectName(cwd);

      if (projectName) {
        updateStmt.run(projectName, window.id);
        logger.debug(`Updated window ${window.id}: auto_name = ${projectName}`);
        updated++;
      } else {
        logger.debug(`Skipping window ${window.id}: not in a project directory (cwd: ${cwd})`);
        skipped++;
      }
    } catch (error) {
      logger.warn(`Failed to migrate window ${window.id}:`, error);
      skipped++;
    }
  }

  // Mark migration as completed
  db.prepare('INSERT INTO migrations (key, completed_at) VALUES (?, ?)').run(
    migrationKey,
    Date.now()
  );

  logger.info(
    `Migration complete: ${updated} windows updated, ${skipped} skipped, ${windows.length} total`
  );
}
