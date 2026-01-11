import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface SessionRecord {
  id: string;
  name: string;
  user_email: string;
  auto_name: string | null;
  created_at: number;
  last_active_at: number;
  state: 'active' | 'dormant' | 'terminated';
  timeout_hours: number;
  working_directory: string;
}

export interface WindowRecord {
  id: string;
  session_id: string;
  name: string | null;
  auto_name: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  z_index: number;
  is_main: number;
  created_at: number;
}

export interface TokenRecord {
  id: string;
  session_id: string;
  device_id: string;
  expires_at: number;
  created_at: number;
}

export interface UserPreferences {
  user_email: string;
  font_size: number;
  session_timeout_hours: number;
  timezone: string;
  quick_key_bar_visible: number;
  side_panel_default_tab: string;
  updated_at: number;
}

export interface DeviceRecord {
  id: string;
  user_email: string;
  name: string | null;
  user_agent: string | null;
  last_seen_at: number;
  created_at: number;
}

export interface AuditLogRecord {
  id?: number;
  timestamp: string;
  level: string;
  event: string;
  session_id: string | null;
  user_email: string;
  device_id: string | null;
  ip: string;
  user_agent: string | null;
  details: string | null;
}

export interface AutomationRecord {
  id: string;
  session_id: string;
  user_email: string;
  name: string;
  trigger_type: string;
  trigger_config: string | null;
  command: string;
  steps: string | null;
  create_window: number;
  window_name: string | null;
  enabled: number;
  created_at: number;
  last_run_at: number | null;
  run_count: number;
}

export interface TemplateRecord {
  id: string;
  user_email: string;
  name: string;
  category: string;
  command: string;
  description: string | null;
  variables: string | null;
  created_at: number;
}

export interface CommandHistoryRecord {
  id: number;
  user_email: string;
  session_id: string | null;
  window_id: string | null;
  command: string;
  executed_at: number;
}

export interface CommandSequenceRecord {
  id: string;
  user_email: string;
  name: string;
  description: string | null;
  steps: string;
  created_at: number;
}

export interface StarredArtifactRecord {
  id: string;
  user_email: string;
  type: string;
  content: string;
  language: string | null;
  title: string | null;
  source_window: string;
  created_at: number;
}

export interface TempArtifactRecord {
  id: string;
  user_email: string;
  type: string;
  content: string;
  language: string | null;
  title: string | null;
  source_window: string | null;
  created_at: number;
  expires_at: number;
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath = '/home/hercules/herakles-terminal/data/zeus.db') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        auto_name TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        state TEXT DEFAULT 'active',
        timeout_hours INTEGER DEFAULT 168,
        working_directory TEXT DEFAULT '/home/hercules'
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_email);
      CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);

      CREATE TABLE IF NOT EXISTS windows (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT,
        auto_name TEXT,
        position_x REAL DEFAULT 0,
        position_y REAL DEFAULT 0,
        width REAL DEFAULT 0.5,
        height REAL DEFAULT 0.5,
        z_index INTEGER DEFAULT 0,
        is_main INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_windows_session ON windows(session_id);

      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_session ON tokens(session_id);
      CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_email TEXT PRIMARY KEY,
        font_size INTEGER DEFAULT 14,
        session_timeout_hours INTEGER DEFAULT 168,
        timezone TEXT DEFAULT 'UTC',
        quick_key_bar_visible INTEGER DEFAULT 0,
        side_panel_default_tab TEXT DEFAULT 'command_builder',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        name TEXT,
        user_agent TEXT,
        last_seen_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_email);

      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_config TEXT,
        command TEXT NOT NULL,
        steps TEXT,
        create_window INTEGER DEFAULT 0,
        window_name TEXT,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_run_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_automations_user ON automations(user_email);
      CREATE INDEX IF NOT EXISTS idx_automations_session ON automations(session_id);
      CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations(trigger_type);

      CREATE TABLE IF NOT EXISTS automation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        automation_id TEXT NOT NULL,
        triggered_at INTEGER NOT NULL,
        trigger_reason TEXT,
        command TEXT NOT NULL,
        output TEXT,
        success INTEGER,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_automation_logs_automation ON automation_logs(automation_id);
      CREATE INDEX IF NOT EXISTS idx_automation_logs_time ON automation_logs(triggered_at);

      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'custom',
        command TEXT NOT NULL,
        description TEXT,
        variables TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_email);
      CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);

      CREATE TABLE IF NOT EXISTS command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        session_id TEXT,
        window_id TEXT,
        command TEXT NOT NULL,
        executed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_command_history_user ON command_history(user_email);
      CREATE INDEX IF NOT EXISTS idx_command_history_session ON command_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_command_history_time ON command_history(executed_at);

      CREATE TABLE IF NOT EXISTS command_sequences (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        steps TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_command_sequences_user ON command_sequences(user_email);

      CREATE TABLE IF NOT EXISTS prompt_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        session_id TEXT,
        window_id TEXT,
        prompt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_history_user ON prompt_history(user_email);
      CREATE INDEX IF NOT EXISTS idx_prompt_history_time ON prompt_history(created_at);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        event TEXT NOT NULL,
        session_id TEXT,
        user_email TEXT NOT NULL,
        device_id TEXT,
        ip TEXT NOT NULL,
        user_agent TEXT,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_email);

      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL,
        lockout_until INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
      CREATE INDEX IF NOT EXISTS idx_rate_limits_lockout ON rate_limits(lockout_until);

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        checksum TEXT
      );

      CREATE TABLE IF NOT EXISTS starred_artifacts (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        language TEXT,
        title TEXT,
        source_window TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_starred_artifacts_user ON starred_artifacts(user_email);
    `);

    this.runMigrations();
  }

  private runMigrations(): void {
    const migrations = [
      {
        version: '001_add_automation_steps',
        sql: `
          ALTER TABLE automations ADD COLUMN steps TEXT;
          ALTER TABLE automations ADD COLUMN create_window INTEGER DEFAULT 0;
          ALTER TABLE automations ADD COLUMN window_name TEXT;
        `,
      },
      {
        version: '002_add_automation_run_count',
        sql: `
          ALTER TABLE automations ADD COLUMN run_count INTEGER DEFAULT 0;
        `,
      },
      {
        version: '003_add_temp_artifacts',
        sql: `
          CREATE TABLE IF NOT EXISTS temp_artifacts (
            id TEXT PRIMARY KEY,
            user_email TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            language TEXT,
            title TEXT,
            source_window TEXT,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_temp_artifacts_user ON temp_artifacts(user_email);
          CREATE INDEX IF NOT EXISTS idx_temp_artifacts_expires ON temp_artifacts(expires_at);
        `,
      },
    ];

    for (const migration of migrations) {
      const existing = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
      if (!existing) {
        try {
          const statements = migration.sql.split(';').filter(s => s.trim());
          for (const stmt of statements) {
            try {
              this.db.exec(stmt);
            } catch (e: unknown) {
              const err = e as { message?: string };
              if (!err.message?.includes('duplicate column')) {
                throw e;
              }
            }
          }
          this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
          console.log(`Migration ${migration.version} applied`);
        } catch (e: unknown) {
          const err = e as { message?: string };
          console.error(`Migration ${migration.version} failed:`, err.message);
        }
      }
    }
  }

  createSession(session: Omit<SessionRecord, 'created_at' | 'last_active_at' | 'state'>): SessionRecord {
    const now = Date.now();
    const record: SessionRecord = {
      ...session,
      created_at: now,
      last_active_at: now,
      state: 'active',
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, name, user_email, auto_name, created_at, last_active_at, state, timeout_hours, working_directory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.name,
      record.user_email,
      record.auto_name,
      record.created_at,
      record.last_active_at,
      record.state,
      record.timeout_hours,
      record.working_directory
    );

    return record;
  }

  getSession(id: string, userEmail: string): SessionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ? AND user_email = ?');
    return stmt.get(id, userEmail) as SessionRecord | null;
  }

  getSessionsByUser(userEmail: string): SessionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE user_email = ? AND state != ? ORDER BY last_active_at DESC');
    return stmt.all(userEmail, 'terminated') as SessionRecord[];
  }

  updateAutoName(id: string, autoName: string, userEmail: string): void {
    const stmt = this.db.prepare('UPDATE sessions SET auto_name = ? WHERE id = ? AND user_email = ?');
    stmt.run(autoName, id, userEmail);
  }

  updateActivity(id: string): void {
    const stmt = this.db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?');
    stmt.run(Date.now(), id);
  }

  updateTimeout(id: string, hours: number, userEmail: string): void {
    const stmt = this.db.prepare('UPDATE sessions SET timeout_hours = ? WHERE id = ? AND user_email = ?');
    stmt.run(hours, id, userEmail);
  }

  updateState(id: string, state: 'active' | 'dormant' | 'terminated'): void {
    const stmt = this.db.prepare('UPDATE sessions SET state = ? WHERE id = ?');
    stmt.run(state, id);
  }

  deleteSession(id: string, userEmail: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ? AND user_email = ?');
    stmt.run(id, userEmail);
  }

  createWindow(window: Omit<WindowRecord, 'created_at'>): WindowRecord {
    const record: WindowRecord = {
      ...window,
      created_at: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO windows (id, session_id, name, auto_name, position_x, position_y, width, height, z_index, is_main, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.session_id,
      record.name,
      record.auto_name,
      record.position_x,
      record.position_y,
      record.width,
      record.height,
      record.z_index,
      record.is_main,
      record.created_at
    );

    return record;
  }

  getWindows(sessionId: string, userEmail: string): WindowRecord[] {
    const stmt = this.db.prepare(`
      SELECT w.* FROM windows w
      JOIN sessions s ON w.session_id = s.id
      WHERE w.session_id = ? AND s.user_email = ?
      ORDER BY w.z_index
    `);
    return stmt.all(sessionId, userEmail) as WindowRecord[];
  }

  updateWindowLayout(
    id: string,
    layout: { position_x: number; position_y: number; width: number; height: number },
    userEmail: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE windows SET position_x = ?, position_y = ?, width = ?, height = ?
      WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_email = ?)
    `);
    stmt.run(layout.position_x, layout.position_y, layout.width, layout.height, id, userEmail);
  }

  deleteWindow(id: string, userEmail: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM windows
      WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_email = ?)
    `);
    stmt.run(id, userEmail);
  }

  createToken(sessionId: string, deviceId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      INSERT INTO tokens (id, session_id, device_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(token, sessionId, deviceId, expiresAt, now);

    return token;
  }

  validateToken(token: string): { sessionId: string; deviceId: string } | null {
    const stmt = this.db.prepare('SELECT session_id, device_id FROM tokens WHERE id = ? AND expires_at > ?');
    const result = stmt.get(token, Date.now()) as { session_id: string; device_id: string } | undefined;
    
    if (result) {
      return { sessionId: result.session_id, deviceId: result.device_id };
    }
    return null;
  }

  getPreferences(userEmail: string): UserPreferences {
    const stmt = this.db.prepare('SELECT * FROM user_preferences WHERE user_email = ?');
    let prefs = stmt.get(userEmail) as UserPreferences | undefined;

    if (!prefs) {
      const now = Date.now();
      const insert = this.db.prepare(`
        INSERT INTO user_preferences (user_email, font_size, session_timeout_hours, timezone, quick_key_bar_visible, side_panel_default_tab, updated_at)
        VALUES (?, 14, 168, 'UTC', 0, 'command_builder', ?)
      `);
      insert.run(userEmail, now);

      prefs = {
        user_email: userEmail,
        font_size: 14,
        session_timeout_hours: 168,
        timezone: 'UTC',
        quick_key_bar_visible: 0,
        side_panel_default_tab: 'command_builder',
        updated_at: now,
      };
    }

    return prefs;
  }

  updatePreferences(userEmail: string, prefs: Partial<Omit<UserPreferences, 'user_email' | 'updated_at'>>): void {
    const existing = this.getPreferences(userEmail);
    const updated = { ...existing, ...prefs, updated_at: Date.now() };

    const stmt = this.db.prepare(`
      UPDATE user_preferences
      SET font_size = ?, session_timeout_hours = ?, timezone = ?, quick_key_bar_visible = ?, side_panel_default_tab = ?, updated_at = ?
      WHERE user_email = ?
    `);
    stmt.run(
      updated.font_size,
      updated.session_timeout_hours,
      updated.timezone,
      updated.quick_key_bar_visible,
      updated.side_panel_default_tab,
      updated.updated_at,
      userEmail
    );
  }

  registerDevice(device: Omit<DeviceRecord, 'created_at' | 'last_seen_at'>): DeviceRecord {
    const now = Date.now();
    const record: DeviceRecord = {
      ...device,
      created_at: now,
      last_seen_at: now,
    };

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO devices (id, user_email, name, user_agent, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(record.id, record.user_email, record.name, record.user_agent, record.last_seen_at, record.created_at);

    return record;
  }

  getDevices(userEmail: string): DeviceRecord[] {
    const stmt = this.db.prepare('SELECT * FROM devices WHERE user_email = ? ORDER BY last_seen_at DESC');
    return stmt.all(userEmail) as DeviceRecord[];
  }

  updateDeviceSeen(deviceId: string): void {
    const stmt = this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?');
    stmt.run(Date.now(), deviceId);
  }

  logAudit(entry: Omit<AuditLogRecord, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (timestamp, level, event, session_id, user_email, device_id, ip, user_agent, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.timestamp,
      entry.level,
      entry.event,
      entry.session_id,
      entry.user_email,
      entry.device_id,
      entry.ip,
      entry.user_agent,
      entry.details
    );
  }

  cleanupExpiredTokens(): number {
    const stmt = this.db.prepare('DELETE FROM tokens WHERE expires_at < ?');
    const result = stmt.run(Date.now());
    return result.changes;
  }

  cleanupInactiveSessions(): number {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET state = 'terminated'
      WHERE state = 'dormant'
      AND (? - last_active_at) > (timeout_hours * 3600000)
    `);
    const result = stmt.run(Date.now());
    return result.changes;
  }

  cleanupOldAuditLogs(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare('DELETE FROM audit_log WHERE timestamp < ?');
    const result = stmt.run(new Date(cutoff).toISOString());
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  getAutomations(userEmail: string): AutomationRecord[] {
    const stmt = this.db.prepare('SELECT * FROM automations WHERE user_email = ? ORDER BY created_at DESC');
    return stmt.all(userEmail) as AutomationRecord[];
  }

  getAutomationsBySession(sessionId: string, userEmail: string): AutomationRecord[] {
    const stmt = this.db.prepare('SELECT * FROM automations WHERE session_id = ? AND user_email = ? ORDER BY created_at DESC');
    return stmt.all(sessionId, userEmail) as AutomationRecord[];
  }

  getAutomation(id: string, userEmail: string): AutomationRecord | null {
    const stmt = this.db.prepare('SELECT * FROM automations WHERE id = ? AND user_email = ?');
    return stmt.get(id, userEmail) as AutomationRecord | null;
  }

  createAutomation(automation: Omit<AutomationRecord, 'created_at' | 'last_run_at'>): AutomationRecord {
    const now = Date.now();
    const record: AutomationRecord = {
      ...automation,
      created_at: now,
      last_run_at: null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO automations (id, session_id, user_email, name, trigger_type, trigger_config, command, steps, create_window, window_name, enabled, created_at, last_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.session_id,
      record.user_email,
      record.name,
      record.trigger_type,
      record.trigger_config,
      record.command,
      record.steps,
      record.create_window,
      record.window_name,
      record.enabled,
      record.created_at,
      record.last_run_at
    );

    return record;
  }

  updateAutomation(id: string, userEmail: string, updates: Partial<Omit<AutomationRecord, 'id' | 'user_email' | 'created_at'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.trigger_type !== undefined) { fields.push('trigger_type = ?'); values.push(updates.trigger_type); }
    if (updates.trigger_config !== undefined) { fields.push('trigger_config = ?'); values.push(updates.trigger_config); }
    if (updates.command !== undefined) { fields.push('command = ?'); values.push(updates.command); }
    if (updates.steps !== undefined) { fields.push('steps = ?'); values.push(updates.steps); }
    if (updates.create_window !== undefined) { fields.push('create_window = ?'); values.push(updates.create_window); }
    if (updates.window_name !== undefined) { fields.push('window_name = ?'); values.push(updates.window_name); }
    if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled); }
    if (updates.last_run_at !== undefined) { fields.push('last_run_at = ?'); values.push(updates.last_run_at); }

    if (fields.length > 0) {
      values.push(id, userEmail);
      const stmt = this.db.prepare(`UPDATE automations SET ${fields.join(', ')} WHERE id = ? AND user_email = ?`);
      stmt.run(...values);
    }
  }

  toggleAutomation(id: string, userEmail: string): void {
    const stmt = this.db.prepare('UPDATE automations SET enabled = NOT enabled WHERE id = ? AND user_email = ?');
    stmt.run(id, userEmail);
  }

  incrementAutomationRunCount(id: string, userEmail: string, maxRuns?: number): { runCount: number; disabled: boolean } {
    const incrStmt = this.db.prepare('UPDATE automations SET run_count = COALESCE(run_count, 0) + 1 WHERE id = ? AND user_email = ?');
    incrStmt.run(id, userEmail);
    
    const automation = this.getAutomation(id, userEmail);
    const runCount = automation?.run_count || 1;
    
    if (maxRuns && maxRuns > 0 && runCount >= maxRuns) {
      const disableStmt = this.db.prepare('UPDATE automations SET enabled = 0 WHERE id = ? AND user_email = ?');
      disableStmt.run(id, userEmail);
      return { runCount, disabled: true };
    }
    
    return { runCount, disabled: false };
  }

  deleteAutomation(id: string, userEmail: string): void {
    const stmt = this.db.prepare('DELETE FROM automations WHERE id = ? AND user_email = ?');
    stmt.run(id, userEmail);
  }

  getTemplates(userEmail: string): TemplateRecord[] {
    const stmt = this.db.prepare('SELECT * FROM templates WHERE user_email = ? ORDER BY category, name');
    return stmt.all(userEmail) as TemplateRecord[];
  }

  getTemplate(id: string, userEmail: string): TemplateRecord | null {
    const stmt = this.db.prepare('SELECT * FROM templates WHERE id = ? AND user_email = ?');
    return stmt.get(id, userEmail) as TemplateRecord | null;
  }

  createTemplate(template: Omit<TemplateRecord, 'created_at'>): TemplateRecord {
    const record: TemplateRecord = {
      ...template,
      created_at: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO templates (id, user_email, name, category, command, description, variables, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.user_email,
      record.name,
      record.category,
      record.command,
      record.description,
      record.variables,
      record.created_at
    );

    return record;
  }

  updateTemplate(id: string, userEmail: string, updates: Partial<Omit<TemplateRecord, 'id' | 'user_email' | 'created_at'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
    if (updates.command !== undefined) { fields.push('command = ?'); values.push(updates.command); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.variables !== undefined) { fields.push('variables = ?'); values.push(updates.variables); }

    if (fields.length > 0) {
      values.push(id, userEmail);
      const stmt = this.db.prepare(`UPDATE templates SET ${fields.join(', ')} WHERE id = ? AND user_email = ?`);
      stmt.run(...values);
    }
  }

  deleteTemplate(id: string, userEmail: string): void {
    const stmt = this.db.prepare('DELETE FROM templates WHERE id = ? AND user_email = ?');
    stmt.run(id, userEmail);
  }

  getCommandHistory(userEmail: string, sessionId?: string, limit = 100): CommandHistoryRecord[] {
    let sql = 'SELECT * FROM command_history WHERE user_email = ?';
    const params: unknown[] = [userEmail];

    if (sessionId) {
      sql += ' AND session_id = ?';
      params.push(sessionId);
    }

    sql += ' ORDER BY executed_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as CommandHistoryRecord[];
  }

  addCommandHistory(entry: Omit<CommandHistoryRecord, 'id' | 'executed_at'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO command_history (user_email, session_id, window_id, command, executed_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(entry.user_email, entry.session_id, entry.window_id, entry.command, Date.now());
  }

  getCommandSuggestions(userEmail: string, prefix: string, limit = 10): { command: string; count: number; last_used: number }[] {
    const stmt = this.db.prepare(`
      SELECT command, COUNT(*) as count, MAX(executed_at) as last_used
      FROM command_history
      WHERE user_email = ? AND command LIKE ?
      GROUP BY command
      ORDER BY count DESC, last_used DESC
      LIMIT ?
    `);
    return stmt.all(userEmail, `${prefix}%`, limit) as { command: string; count: number; last_used: number }[];
  }

  getCommandSequences(userEmail: string): CommandSequenceRecord[] {
    const stmt = this.db.prepare('SELECT * FROM command_sequences WHERE user_email = ? ORDER BY name');
    return stmt.all(userEmail) as CommandSequenceRecord[];
  }

  getCommandSequence(id: string, userEmail: string): CommandSequenceRecord | null {
    const stmt = this.db.prepare('SELECT * FROM command_sequences WHERE id = ? AND user_email = ?');
    return stmt.get(id, userEmail) as CommandSequenceRecord | null;
  }

  createCommandSequence(sequence: Omit<CommandSequenceRecord, 'created_at'>): CommandSequenceRecord {
    const record: CommandSequenceRecord = {
      ...sequence,
      created_at: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO command_sequences (id, user_email, name, description, steps, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.user_email,
      record.name,
      record.description,
      record.steps,
      record.created_at
    );

    return record;
  }

  updateCommandSequence(id: string, userEmail: string, updates: Partial<Omit<CommandSequenceRecord, 'id' | 'user_email' | 'created_at'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.steps !== undefined) { fields.push('steps = ?'); values.push(updates.steps); }

    if (fields.length > 0) {
      values.push(id, userEmail);
      const stmt = this.db.prepare(`UPDATE command_sequences SET ${fields.join(', ')} WHERE id = ? AND user_email = ?`);
      stmt.run(...values);
    }
  }

  deleteCommandSequence(id: string, userEmail: string): void {
    const stmt = this.db.prepare('DELETE FROM command_sequences WHERE id = ? AND user_email = ?');
    stmt.run(id, userEmail);
  }

  getStarredArtifacts(userEmail: string): StarredArtifactRecord[] {
    const stmt = this.db.prepare('SELECT * FROM starred_artifacts WHERE user_email = ? ORDER BY created_at DESC');
    return stmt.all(userEmail) as StarredArtifactRecord[];
  }

  getStarredArtifact(id: string, userEmail: string): StarredArtifactRecord | null {
    const stmt = this.db.prepare('SELECT * FROM starred_artifacts WHERE id = ? AND user_email = ?');
    return stmt.get(id, userEmail) as StarredArtifactRecord | null;
  }

  starArtifact(artifact: Omit<StarredArtifactRecord, 'created_at'>): StarredArtifactRecord {
    const record: StarredArtifactRecord = {
      ...artifact,
      created_at: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO starred_artifacts (id, user_email, type, content, language, title, source_window, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.user_email,
      record.type,
      record.content,
      record.language,
      record.title,
      record.source_window,
      record.created_at
    );

    return record;
  }

  unstarArtifact(id: string, userEmail: string): void {
    const stmt = this.db.prepare('DELETE FROM starred_artifacts WHERE id = ? AND user_email = ?');
    stmt.run(id, userEmail);
  }

  isArtifactStarred(id: string, userEmail: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM starred_artifacts WHERE id = ? AND user_email = ?');
    return !!stmt.get(id, userEmail);
  }

  saveTempArtifact(artifact: Omit<TempArtifactRecord, 'created_at' | 'expires_at'>, ttlMs: number = 60 * 60 * 1000): TempArtifactRecord {
    const now = Date.now();
    const record: TempArtifactRecord = {
      ...artifact,
      created_at: now,
      expires_at: now + ttlMs,
    };

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO temp_artifacts (id, user_email, type, content, language, title, source_window, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.user_email,
      record.type,
      record.content,
      record.language,
      record.title,
      record.source_window,
      record.created_at,
      record.expires_at
    );

    return record;
  }

  getTempArtifacts(userEmail: string): TempArtifactRecord[] {
    const now = Date.now();
    this.db.prepare('DELETE FROM temp_artifacts WHERE expires_at < ?').run(now);
    const stmt = this.db.prepare('SELECT * FROM temp_artifacts WHERE user_email = ? AND expires_at > ? ORDER BY created_at DESC');
    return stmt.all(userEmail, now) as TempArtifactRecord[];
  }

  deleteTempArtifact(id: string, userEmail: string): void {
    const stmt = this.db.prepare('DELETE FROM temp_artifacts WHERE id = ? AND user_email = ?');
    stmt.run(id, userEmail);
  }

  cleanupExpiredTempArtifacts(): number {
    const result = this.db.prepare('DELETE FROM temp_artifacts WHERE expires_at < ?').run(Date.now());
    return result.changes;
  }
}

export const sessionStore = new SessionStore();
