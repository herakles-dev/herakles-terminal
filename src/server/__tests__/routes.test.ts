import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { apiRoutes } from '../api/routes.js';
import { SessionStore } from '../session/SessionStore.js';
import * as fs from 'fs';

describe('API Routes', () => {
  let app: express.Application;
  let store: SessionStore;
  const testDbPath = '/tmp/zeus-api-test-' + Date.now() + '.db';

  beforeEach(() => {
    store = new SessionStore(testDbPath);
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.user = { 
        username: 'testuser', 
        email: 'test@example.com',
        groups: [],
      };
      next();
    });
    app.use('/api', apiRoutes(store));
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const walPath = testDbPath + '-wal';
    const shmPath = testDbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  describe('GET /api/sessions', () => {
    it('returns empty array for new user', async () => {
      const response = await request(app).get('/api/sessions');
      
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it('returns user sessions', async () => {
      store.createSession({
        id: 'session-1',
        name: 'Test Session',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const response = await request(app).get('/api/sessions');
      
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Test Session');
    });
  });

  describe('POST /api/sessions', () => {
    it('creates a new session', async () => {
      const response = await request(app)
        .post('/api/sessions')
        .send({ name: 'New Session' });

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('New Session');
      expect(response.body.data.state).toBe('active');
    });

    it('auto-generates name if not provided', async () => {
      const response = await request(app)
        .post('/api/sessions')
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('Session 1');
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('returns session by id', async () => {
      store.createSession({
        id: 'get-session-test',
        name: 'Get Test',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const response = await request(app).get('/api/sessions/get-session-test');

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe('get-session-test');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app).get('/api/sessions/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('PUT /api/sessions/:id', () => {
    it('updates session name', async () => {
      store.createSession({
        id: 'update-test',
        name: 'Original',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const response = await request(app)
        .put('/api/sessions/update-test')
        .send({ name: 'Updated' });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Updated');
    });

    it('updates timeout hours', async () => {
      store.createSession({
        id: 'timeout-test',
        name: 'Timeout Test',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const response = await request(app)
        .put('/api/sessions/timeout-test')
        .send({ timeoutHours: 72 });

      expect(response.status).toBe(200);
      expect(response.body.data.timeoutHours).toBe(72);
    });
  });

  describe('DELETE /api/sessions/:id', () => {
    it('deletes session', async () => {
      store.createSession({
        id: 'delete-test',
        name: 'Delete Test',
        user_email: 'test@example.com',
        auto_name: null,
        timeout_hours: 168,
        working_directory: '/home/test',
      });

      const response = await request(app).delete('/api/sessions/delete-test');

      expect(response.status).toBe(200);
      expect(response.body.data.success).toBe(true);

      const getResponse = await request(app).get('/api/sessions/delete-test');
      expect(getResponse.status).toBe(404);
    });
  });

  describe('GET /api/preferences', () => {
    it('returns default preferences for new user', async () => {
      const response = await request(app).get('/api/preferences');

      expect(response.status).toBe(200);
      expect(response.body.data.fontSize).toBe(14);
      expect(response.body.data.sessionTimeoutHours).toBe(168);
    });
  });

  describe('PUT /api/preferences', () => {
    it('updates preferences', async () => {
      const response = await request(app)
        .put('/api/preferences')
        .send({
          fontSize: 18,
          quickKeyBarVisible: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.fontSize).toBe(18);
      expect(response.body.data.quickKeyBarVisible).toBe(true);
    });
  });
});
