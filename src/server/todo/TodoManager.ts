/**
 * TodoManager - Central todo state management with session-based grouping
 *
 * Manages Claude Code TodoWrite UI synchronization between server and connected clients.
 * Stores todos by Claude session ID and broadcasts to all subscribed WebSockets.
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import type {
  TodoItem,
  SessionTodos,
  TodoAllSessionsMessage,
} from '../../shared/todoProtocol.js';
import { deriveSessionName } from '../../shared/todoProtocol.js';
import { logger } from '../utils/logger.js';
import { todoFileWatcher, TodosBySession as WatcherTodosBySession, AllTodosEvent } from './TodoFileWatcher.js';

/**
 * Central manager for todo state synchronization.
 *
 * Listens to TodoFileWatcher for file changes and broadcasts
 * session-grouped todos to all connected clients.
 */
export class TodoManager extends EventEmitter {
  /** All subscribed WebSocket connections */
  private subscribers: Set<WebSocket> = new Set();

  /** One close handler per ws — survives subscribe/unsubscribe cycles. */
  private wsCloseHandlers: WeakMap<WebSocket, () => void> = new WeakMap();

  /** Cached sessions for new subscribers */
  private cachedSessions: SessionTodos[] = [];

  constructor() {
    super();
    logger.info('TodoManager initialized');
    this.setupWatcherListener();
  }

  /**
   * Set up listener for TodoFileWatcher events
   */
  private setupWatcherListener(): void {
    todoFileWatcher.on('allTodos', (event: AllTodosEvent) => {
      this.handleTodosUpdate(event.todosBySession);
    });
  }

  /**
   * Handle todo updates from file watcher
   */
  private handleTodosUpdate(todosBySession: WatcherTodosBySession): void {
    // Convert to array of SessionTodos sorted by lastModified
    const sessions: SessionTodos[] = Object.entries(todosBySession)
      .map(([sessionId, data]) => ({
        sessionId,
        sessionName: deriveSessionName(sessionId),
        todos: data.todos,
        lastModified: data.lastModified,
      }))
      .sort((a, b) => b.lastModified - a.lastModified);

    this.cachedSessions = sessions;

    // Broadcast to all subscribers
    this.broadcastAllSessions(sessions);
  }

  /**
   * Subscribe a WebSocket connection to todo updates.
   * Immediately sends current state.
   */
  subscribe(_windowId: string, ws: WebSocket): void {
    // We ignore windowId now - all subscribers get all sessions
    if (this.subscribers.has(ws)) {
      logger.debug('TodoManager: WebSocket already subscribed');
      return;
    }

    this.subscribers.add(ws);
    logger.info(`TodoManager: Added subscriber (total: ${this.subscribers.size})`);

    // Register with file watcher
    todoFileWatcher.subscribe();

    // If our cache is empty, try to get data from file watcher's cache
    if (this.cachedSessions.length === 0) {
      const watcherCache = todoFileWatcher.getCurrentTodos();
      if (Object.keys(watcherCache).length > 0) {
        this.cachedSessions = Object.entries(watcherCache)
          .map(([sessionId, data]) => ({
            sessionId,
            sessionName: deriveSessionName(sessionId),
            todos: data.todos,
            lastModified: data.lastModified,
          }))
          .sort((a, b) => b.lastModified - a.lastModified);
        logger.info(`TodoManager: Initialized cache from file watcher (${this.cachedSessions.length} sessions)`);
      } else {
        logger.info('TodoManager: No cached sessions available from file watcher');
      }
    }

    // Send current cached state (even if empty, so client knows we're ready)
    logger.info(`TodoManager: Sending initial state with ${this.cachedSessions.length} sessions to new subscriber`);
    this.sendAllSessions(ws, this.cachedSessions);

    // Trigger a refresh to get latest data
    logger.info('TodoManager: Triggering file watcher refresh');
    todoFileWatcher.refresh();

    // Attach close handler exactly once per ws. Survives subscribe/unsubscribe
    // cycles without accumulating listeners.
    if (!this.wsCloseHandlers.has(ws)) {
      const handleClose = (): void => {
        this.unsubscribe(ws);
        this.wsCloseHandlers.delete(ws);
        ws.removeListener('close', handleClose);
      };
      this.wsCloseHandlers.set(ws, handleClose);
      ws.on('close', handleClose);
    }
  }

  /**
   * Unsubscribe a WebSocket connection from todo updates.
   */
  unsubscribe(ws: WebSocket): void {
    const wasSubscribed = this.subscribers.delete(ws);
    if (wasSubscribed) {
      logger.debug(`TodoManager: Removed subscriber (remaining: ${this.subscribers.size})`);
    }
  }

  /**
   * Unsubscribe a WebSocket from all updates.
   */
  unsubscribeAll(ws: WebSocket): void {
    this.unsubscribe(ws);
  }

  /**
   * Broadcast all sessions to all subscribers
   */
  private broadcastAllSessions(sessions: SessionTodos[]): void {
    if (this.subscribers.size === 0) {
      logger.debug('TodoManager: No subscribers to broadcast to');
      return;
    }

    const totalTodos = sessions.reduce((sum, s) => sum + s.todos.length, 0);
    logger.info(`TodoManager: Broadcasting ${sessions.length} sessions (${totalTodos} total todos) to ${this.subscribers.size} subscribers`);

    const message: TodoAllSessionsMessage = {
      type: 'todo:allSessions',
      sessions,
    };

    const messageStr = JSON.stringify(message);

    for (const ws of this.subscribers) {
      this.sendToWebSocket(ws, messageStr);
    }
  }

  /**
   * Send all sessions to a specific WebSocket
   */
  private sendAllSessions(ws: WebSocket, sessions: SessionTodos[]): void {
    const message: TodoAllSessionsMessage = {
      type: 'todo:allSessions',
      sessions,
    };

    this.sendToWebSocket(ws, JSON.stringify(message));
  }

  /**
   * Send a message to a WebSocket connection.
   */
  private sendToWebSocket(ws: WebSocket, message: string): void {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    } catch (err) {
      logger.error('TodoManager: Error sending message to WebSocket:', err);
    }
  }

  /**
   * Get statistics about the TodoManager state.
   */
  getStats(): {
    sessionsCount: number;
    totalTodos: number;
    subscriberCount: number;
  } {
    const totalTodos = this.cachedSessions.reduce((sum, s) => sum + s.todos.length, 0);

    return {
      sessionsCount: this.cachedSessions.length,
      totalTodos,
      subscriberCount: this.subscribers.size,
    };
  }

  // Legacy compatibility methods
  getTodos(_windowId: string): TodoItem[] {
    // Return todos from most recent session
    return this.cachedSessions[0]?.todos ?? [];
  }

  updateTodos(
    _windowId: string,
    _todos: TodoItem[],
    _source: 'file' | 'output' | 'manual'
  ): void {
    // No longer used - file watcher handles updates
  }

  clearWindow(_windowId: string): void {
    // No longer needed - sessions are managed by file watcher
  }
}

/**
 * Singleton instance of TodoManager.
 */
export const todoManager = new TodoManager();
