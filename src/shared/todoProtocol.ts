/**
 * Claude Code TodoWrite UI Protocol
 * Shared types for real-time todo synchronization between server and client
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  // Core fields (legacy format - always present)
  id: string;
  content: string;
  activeForm: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;

  // Extended fields (Claude Code 2.1.16+ format - optional)
  subject?: string;                    // Imperative form title (e.g., "Build app")
  description?: string;                // Detailed requirements and acceptance criteria
  owner?: string;                      // Agent ID assignment for multi-agent coordination
  blocks?: string[];                   // Task IDs that this task blocks
  blockedBy?: string[];                // Task IDs blocking this task from starting
  metadata?: Record<string, unknown>;  // Extensible custom data (priority, tags, etc.)
}

export interface TodoState {
  windowId: string;
  todos: TodoItem[];
  lastUpdated: number;
  source: 'file' | 'output' | 'manual';
}

// Client → Server messages
export interface TodoSubscribeMessage {
  type: 'todo:subscribe';
  windowId: string;
}

export interface TodoUnsubscribeMessage {
  type: 'todo:unsubscribe';
  windowId: string;
}

// Session-based todo structure (keyed by Claude session ID)
export interface SessionTodos {
  sessionId: string;
  sessionName: string; // Short display name derived from session ID
  todos: TodoItem[];
  lastModified: number;
}

export interface TodosBySession {
  [sessionId: string]: SessionTodos;
}

// Server → Client messages
export interface TodoUpdateMessage {
  type: 'todo:update';
  windowId: string;
  todos: TodoItem[];
  source: 'file' | 'output' | 'manual';
}

export interface TodoSyncMessage {
  type: 'todo:sync';
  windowId: string;
  todos: TodoItem[];
}

export interface TodoClearMessage {
  type: 'todo:clear';
  windowId: string;
}

// New: All sessions sync message
export interface TodoAllSessionsMessage {
  type: 'todo:allSessions';
  sessions: SessionTodos[];
}

// Union types for message handling
export type TodoClientMessage = TodoSubscribeMessage | TodoUnsubscribeMessage;
export type TodoServerMessage = TodoUpdateMessage | TodoSyncMessage | TodoClearMessage | TodoAllSessionsMessage;

// File format for .claude-todos.json
export interface ClaudeTodosFile {
  version: 1;
  todos: Array<{
    content: string;
    status: TodoStatus;
    activeForm: string;
  }>;
  updatedAt: string;
}

// Utility functions
export function createTodoId(content: string, index: number): string {
  return `todo-${index}-${content.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}`;
}

/**
 * Derive a short display name from a Claude session ID.
 * Claude uses UUIDs like "dcdc3eab-16cb-4484-85d7-edb790b350ad"
 * We take the first segment and make it more readable.
 */
export function deriveSessionName(sessionId: string): string {
  // Take the first segment of the UUID and capitalize it
  const firstSegment = sessionId.split('-')[0] || sessionId.slice(0, 8);
  return `Session ${firstSegment.toUpperCase()}`;
}

export function parseTodosFromFile(content: string): TodoItem[] | null {
  try {
    const parsed = JSON.parse(content);
    const now = Date.now();

    // Handle Claude Code's native format: plain array of todos
    if (Array.isArray(parsed)) {
      return parsed.map((todo, index) => {
        // Core fields (legacy format - always present)
        const todoItem: TodoItem = {
          id: todo.id || createTodoId(todo.content || todo.subject || '', index),
          content: todo.content || todo.subject || '',
          activeForm: todo.activeForm || todo.content || todo.subject || '',
          status: todo.status || 'pending',
          createdAt: todo.createdAt || now,
          updatedAt: todo.updatedAt || now,
        };

        // Extended fields (Claude Code 2.1.16+ format - optional)
        if (todo.subject !== undefined) todoItem.subject = todo.subject;
        if (todo.description !== undefined) todoItem.description = todo.description;
        if (todo.owner !== undefined) todoItem.owner = todo.owner;
        if (Array.isArray(todo.blocks)) todoItem.blocks = todo.blocks;
        if (Array.isArray(todo.blockedBy)) todoItem.blockedBy = todo.blockedBy;
        if (todo.metadata !== undefined && typeof todo.metadata === 'object') {
          todoItem.metadata = todo.metadata;
        }

        return todoItem;
      });
    }

    // Handle wrapped format with version field
    if (parsed.version === 1 && Array.isArray(parsed.todos)) {
      return parsed.todos.map((todo: any, index: number) => {
        // Core fields
        const todoItem: TodoItem = {
          id: todo.id || createTodoId(todo.content || todo.subject, index),
          content: todo.content || todo.subject || '',
          activeForm: todo.activeForm || todo.content || todo.subject || '',
          status: todo.status || 'pending',
          createdAt: todo.createdAt || now,
          updatedAt: todo.updatedAt || now,
        };

        // Extended fields (optional)
        if (todo.subject !== undefined) todoItem.subject = todo.subject;
        if (todo.description !== undefined) todoItem.description = todo.description;
        if (todo.owner !== undefined) todoItem.owner = todo.owner;
        if (Array.isArray(todo.blocks)) todoItem.blocks = todo.blocks;
        if (Array.isArray(todo.blockedBy)) todoItem.blockedBy = todo.blockedBy;
        if (todo.metadata !== undefined && typeof todo.metadata === 'object') {
          todoItem.metadata = todo.metadata;
        }

        return todoItem;
      });
    }

    // Handle single task object (Claude Code 2.1.16+ individual task files)
    if (parsed.id !== undefined && typeof parsed.subject === 'string') {
      const now = Date.now();
      const todoItem: TodoItem = {
        // Core fields (required)
        id: parsed.id,
        content: parsed.subject || parsed.description || '',
        activeForm: parsed.activeForm || parsed.subject || '',
        status: parsed.status || 'pending',
        createdAt: parsed.createdAt || now,
        updatedAt: parsed.updatedAt || now,

        // Extended fields (optional)
        subject: parsed.subject,
        description: parsed.description,
        owner: parsed.owner,
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks : undefined,
        blockedBy: Array.isArray(parsed.blockedBy) ? parsed.blockedBy : undefined,
        metadata: parsed.metadata,
      };
      return [todoItem]; // Return as single-element array
    }

    return null;
  } catch {
    return null;
  }
}

// Marker pattern for terminal output detection
export const TODO_MARKER_START = '<!-- ZEUS_TODO_UPDATE:';
export const TODO_MARKER_END = '-->';

export function extractTodosFromOutput(output: string): TodoItem[] | null {
  const startIdx = output.indexOf(TODO_MARKER_START);
  if (startIdx === -1) return null;

  const endIdx = output.indexOf(TODO_MARKER_END, startIdx);
  if (endIdx === -1) return null;

  const jsonStr = output.slice(startIdx + TODO_MARKER_START.length, endIdx).trim();
  try {
    const parsed = JSON.parse(jsonStr) as { todos: Array<any> };
    if (!Array.isArray(parsed.todos)) return null;

    const now = Date.now();
    return parsed.todos.map((todo, index) => {
      // Core fields (legacy format - always present)
      const todoItem: TodoItem = {
        id: todo.id || createTodoId(todo.content || todo.subject || '', index),
        content: todo.content || todo.subject || '',
        activeForm: todo.activeForm || todo.content || todo.subject || '',
        status: todo.status || 'pending',
        createdAt: todo.createdAt || now,
        updatedAt: todo.updatedAt || now,
      };

      // Extended fields (Claude Code 2.1.16+ format - optional)
      if (todo.subject !== undefined) todoItem.subject = todo.subject;
      if (todo.description !== undefined) todoItem.description = todo.description;
      if (todo.owner !== undefined) todoItem.owner = todo.owner;
      if (Array.isArray(todo.blocks)) todoItem.blocks = todo.blocks;
      if (Array.isArray(todo.blockedBy)) todoItem.blockedBy = todo.blockedBy;
      if (todo.metadata !== undefined && typeof todo.metadata === 'object') {
        todoItem.metadata = todo.metadata;
      }

      return todoItem;
    });
  } catch {
    return null;
  }
}
