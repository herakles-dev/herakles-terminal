import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../session/SessionStore.js';
import * as fs from 'fs';

describe('SessionStore', () => {
  let store: SessionStore;
  const testDbPath = '/tmp/zeus-test-' + Date.now() + '.db';

  beforeEach(() => {
    store = new SessionStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const walPath = testDbPath + '-wal';
    const shmPath = testDbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  describe('sessions', () => {
    it('creates a session with correct defaults', () => {
      const session = store.createSession({
        id: 'test-session-1',
        name: 'Test Session',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      expect(session.id).toBe('test-session-1');
      expect(session.name).toBe('Test Session');
      expect(session.state).toBe('active');
      expect(session.created_at).toBeGreaterThan(0);
      expect(session.last_active_at).toBeGreaterThan(0);
    });

    it('retrieves a session by id and user email', () => {
      store.createSession({
        id: 'test-session-2',
        name: 'Test Session 2',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const session = store.getSession('test-session-2', 'test@example.com');
      expect(session).not.toBeNull();
      expect(session?.name).toBe('Test Session 2');
    });

    it('returns null for non-existent session', () => {
      const session = store.getSession('non-existent', 'test@example.com');
      expect(session).toBeNull();
    });

    it('enforces user email ownership', () => {
      store.createSession({
        id: 'test-session-3',
        name: 'Test Session 3',
        user_email: 'owner@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const session = store.getSession('test-session-3', 'other@example.com');
      expect(session).toBeNull();
    });

    it('lists sessions by user', () => {
      store.createSession({
        id: 'user1-session',
        name: 'User 1 Session',
        user_email: 'user1@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      store.createSession({
        id: 'user2-session',
        name: 'User 2 Session',
        user_email: 'user2@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const user1Sessions = store.getSessionsByUser('user1@example.com');
      const user2Sessions = store.getSessionsByUser('user2@example.com');

      expect(user1Sessions).toHaveLength(1);
      expect(user2Sessions).toHaveLength(1);
      expect(user1Sessions[0].name).toBe('User 1 Session');
    });

    it('updates session state', () => {
      store.createSession({
        id: 'state-test',
        name: 'State Test',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      store.updateState('state-test', 'dormant');
      const session = store.getSession('state-test', 'test@example.com');
      expect(session?.state).toBe('dormant');
    });

    it('deletes session', () => {
      store.createSession({
        id: 'delete-test',
        name: 'Delete Test',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      store.deleteSession('delete-test', 'test@example.com');
      const session = store.getSession('delete-test', 'test@example.com');
      expect(session).toBeNull();
    });
  });

  describe('windows', () => {
    beforeEach(() => {
      store.createSession({
        id: 'window-test-session',
        name: 'Window Test Session',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });
    });

    it('creates a window', () => {
      const window = store.createWindow({
        id: 'test-window-1',
        session_id: 'window-test-session',
        name: 'Main',
        auto_name: null,
        position_x: 0,
        position_y: 0,
        width: 1,
        height: 1,
        z_index: 0,
        is_main: 1,
      });

      expect(window.id).toBe('test-window-1');
      expect(window.is_main).toBe(1);
    });

    it('lists windows for session', () => {
      store.createWindow({
        id: 'window-1',
        session_id: 'window-test-session',
        name: 'Main',
        auto_name: null,
        position_x: 0,
        position_y: 0,
        width: 0.5,
        height: 1,
        z_index: 0,
        is_main: 1,
      });

      store.createWindow({
        id: 'window-2',
        session_id: 'window-test-session',
        name: 'Secondary',
        auto_name: null,
        position_x: 0.5,
        position_y: 0,
        width: 0.5,
        height: 1,
        z_index: 1,
        is_main: 0,
      });

      const windows = store.getWindows('window-test-session', 'test@example.com');
      expect(windows).toHaveLength(2);
    });

    it('updates window layout', () => {
      store.createWindow({
        id: 'layout-test',
        session_id: 'window-test-session',
        name: 'Layout Test',
        auto_name: null,
        position_x: 0,
        position_y: 0,
        width: 1,
        height: 1,
        z_index: 0,
        is_main: 1,
      });

      store.updateWindowLayout('layout-test', {
        position_x: 0.25,
        position_y: 0.25,
        width: 0.5,
        height: 0.5,
      }, 'test@example.com');

      const windows = store.getWindows('window-test-session', 'test@example.com');
      const updated = windows.find(w => w.id === 'layout-test');
      expect(updated?.position_x).toBe(0.25);
      expect(updated?.width).toBe(0.5);
    });
  });

  describe('preferences', () => {
    it('creates default preferences for new user', () => {
      const prefs = store.getPreferences('new-user@example.com');

      expect(prefs.font_size).toBe(14);
      expect(prefs.session_timeout_hours).toBe(168);
      expect(prefs.timezone).toBe('UTC');
      expect(prefs.quick_key_bar_visible).toBe(0);
    });

    it('updates preferences', () => {
      store.getPreferences('pref-user@example.com');

      store.updatePreferences('pref-user@example.com', {
        font_size: 16,
        quick_key_bar_visible: 1,
      });

      const prefs = store.getPreferences('pref-user@example.com');
      expect(prefs.font_size).toBe(16);
      expect(prefs.quick_key_bar_visible).toBe(1);
    });
  });

  describe('tokens', () => {
    beforeEach(() => {
      store.createSession({
        id: 'token-test-session',
        name: 'Token Test',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });
    });

    it('creates and validates token', () => {
      const token = store.createToken('token-test-session', 'device-1');
      expect(token).toBeTruthy();
      expect(token.length).toBeGreaterThan(32);

      const validated = store.validateToken(token);
      expect(validated).not.toBeNull();
      expect(validated?.sessionId).toBe('token-test-session');
      expect(validated?.deviceId).toBe('device-1');
    });

    it('rejects invalid token', () => {
      const result = store.validateToken('invalid-token');
      expect(result).toBeNull();
    });

    it('cleans up expired tokens', () => {
      const db = store.getDatabase();
      const now = Date.now();
      
      db.prepare(`
        INSERT INTO tokens (id, session_id, device_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('expired-token', 'token-test-session', 'device-1', now - 1000, now - 86400000);

      const cleaned = store.cleanupExpiredTokens();
      expect(cleaned).toBeGreaterThanOrEqual(1);

      const result = store.validateToken('expired-token');
      expect(result).toBeNull();
    });
  });

  describe('automations', () => {
    beforeEach(() => {
      store.createSession({
        id: 'auto-test-session',
        name: 'Automation Test',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });
    });

    it('creates automation', () => {
      const automation = store.createAutomation({
        id: 'auto-1',
        session_id: 'auto-test-session',
        user_email: 'test@example.com',
        name: 'On Connect',
        trigger_type: 'on_connect',
        trigger_config: '{}',
        command: 'echo "Hello"',
        steps: null,
        create_window: 0,
        window_name: null,
        enabled: 1,
      });

      expect(automation.id).toBe('auto-1');
      expect(automation.trigger_type).toBe('on_connect');
    });

    it('lists automations by session', () => {
      store.createAutomation({
        id: 'auto-list-1',
        session_id: 'auto-test-session',
        user_email: 'test@example.com',
        name: 'Auto 1',
        trigger_type: 'on_connect',
        trigger_config: '{}',
        command: 'echo "1"',
        steps: null,
        create_window: 0,
        window_name: null,
        enabled: 1,
      });

      store.createAutomation({
        id: 'auto-list-2',
        session_id: 'auto-test-session',
        user_email: 'test@example.com',
        name: 'Auto 2',
        trigger_type: 'on_idle',
        trigger_config: '{"timeout": 300}',
        command: 'echo "2"',
        steps: null,
        create_window: 0,
        window_name: null,
        enabled: 1,
      });

      const automations = store.getAutomationsBySession('auto-test-session', 'test@example.com');
      expect(automations).toHaveLength(2);
    });

    it('toggles automation', () => {
      store.createAutomation({
        id: 'toggle-test',
        session_id: 'auto-test-session',
        user_email: 'test@example.com',
        name: 'Toggle Test',
        trigger_type: 'on_connect',
        trigger_config: '{}',
        command: 'echo "test"',
        steps: null,
        create_window: 0,
        window_name: null,
        enabled: 1,
      });

      store.toggleAutomation('toggle-test', 'test@example.com');
      
      let auto = store.getAutomation('toggle-test', 'test@example.com');
      expect(auto?.enabled).toBe(0);

      store.toggleAutomation('toggle-test', 'test@example.com');
      auto = store.getAutomation('toggle-test', 'test@example.com');
      expect(auto?.enabled).toBe(1);
    });
  });

  describe('command history', () => {
    it('adds and retrieves command history', () => {
      store.addCommandHistory({
        user_email: 'test@example.com',
        session_id: 'session-1',
        window_id: 'window-1',
        command: 'ls -la',
      });

      store.addCommandHistory({
        user_email: 'test@example.com',
        session_id: 'session-1',
        window_id: 'window-1',
        command: 'cd /home',
      });

      const history = store.getCommandHistory('test@example.com', 'session-1', 10);
      expect(history).toHaveLength(2);
    });

    it('gets command suggestions', () => {
      for (let i = 0; i < 5; i++) {
        store.addCommandHistory({
          user_email: 'test@example.com',
          session_id: null,
          window_id: null,
          command: 'git status',
        });
      }

      store.addCommandHistory({
        user_email: 'test@example.com',
        session_id: null,
        window_id: null,
        command: 'git log',
      });

      const suggestions = store.getCommandSuggestions('test@example.com', 'git', 10);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].command).toBe('git status');
      expect(suggestions[0].count).toBe(5);
    });
  });
});
