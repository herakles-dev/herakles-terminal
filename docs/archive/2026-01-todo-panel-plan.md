# Zeus Terminal: Claude Code TodoWrite UI Integration

## Feature Overview

**Goal:** Add a native Claude Code to-do list UI as a left-side collapsible toolbar that displays live TodoWrite updates per terminal window.

**Requirements:**
- Left side placement, thin collapsible design (~48px collapsed, ~280px expanded)
- Live WebSocket updates from Claude Code's TodoWrite tool
- Per-window ID association (each window has independent todos)
- Theme-consistent styling (glass effect, cyan accents)
- Smooth window switching support

---

## Technical Challenge: Capturing TodoWrite Data

Claude Code runs inside terminal windows as an AI process. The TodoWrite data is internal to Claude Code. We need to capture this data.

### Solution: File-Based Sync + Output Detection (Hybrid)

**Primary Mechanism: File Watcher**
- Watch for `.claude-todos.json` in each window's working directory
- When Claude Code writes todos, we detect via `fs.watch()`
- Reliable, version-independent

**Secondary Mechanism: Output Detection**
- Parse terminal output for marker patterns
- Format: `<!-- ZEUS_TODO_UPDATE: { todos: [...] } -->`
- Provides immediate feedback before file write

**Storage: In-Memory + SQLite Persistence**
- Keep todos in server memory for fast access
- Optional SQLite persistence for session resume

---

## Architecture

### New Files

```
src/client/
├── components/
│   └── TodoPanel/
│       ├── TodoPanel.tsx           # Main collapsible container
│       ├── TodoItem.tsx            # Individual todo item component
│       ├── TodoList.tsx            # Scrollable list container
│       └── index.ts                # Barrel export
├── hooks/
│   └── useTodoSync.ts              # WebSocket subscription hook

src/server/
├── todo/
│   ├── TodoManager.ts              # Central todo state management
│   ├── TodoFileWatcher.ts          # File system watcher per window
│   └── TodoOutputParser.ts         # Terminal output marker parser

src/shared/
└── todoProtocol.ts                 # Shared types & WebSocket messages
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLAUDE CODE (in terminal)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┴────────────────────┐
         ▼                                          ▼
┌─────────────────────┐                   ┌─────────────────────┐
│  Writes to file:    │                   │  Terminal output    │
│ .claude-todos.json  │                   │  (fallback marker)  │
└─────────────────────┘                   └─────────────────────┘
         │                                          │
         ▼                                          ▼
┌─────────────────────┐                   ┌─────────────────────┐
│  TodoFileWatcher    │                   │  TodoOutputParser   │
│  (fs.watch)         │                   │  (stream intercept) │
└─────────────────────┘                   └─────────────────────┘
         │                                          │
         └────────────────────┬────────────────────┘
                              ▼
                   ┌─────────────────────┐
                   │    TodoManager      │
                   │  (state per window) │
                   └─────────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │ WebSocket broadcast │
                   │ type: 'todo:update' │
                   └─────────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │     TodoPanel       │
                   │   (React UI)        │
                   └─────────────────────┘
```

---

## WebSocket Protocol

### New Message Types

```typescript
// src/shared/todoProtocol.ts

export interface TodoItem {
  id: string;
  content: string;           // Task description
  activeForm: string;        // Present continuous form
  status: 'pending' | 'in_progress' | 'completed';
  updatedAt: number;
}

export interface TodoState {
  windowId: string;
  todos: TodoItem[];
  lastUpdated: number;
}

// Client → Server
export interface TodoSubscribeMessage {
  type: 'todo:subscribe';
  windowId: string;
}

export interface TodoUnsubscribeMessage {
  type: 'todo:unsubscribe';
  windowId: string;
}

// Server → Client
export interface TodoUpdateMessage {
  type: 'todo:update';
  windowId: string;
  todos: TodoItem[];
}

export interface TodoSyncMessage {
  type: 'todo:sync';
  windowId: string;
  todos: TodoItem[];
}
```

---

## Database Schema (Optional Persistence)

```sql
-- Migration: 004_add_window_todos
CREATE TABLE IF NOT EXISTS window_todos (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  active_form TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (window_id) REFERENCES windows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_todos_window ON window_todos(window_id);
CREATE INDEX IF NOT EXISTS idx_todos_status ON window_todos(status);
```

---

## UI Component Design

### TodoPanel States

**Collapsed (48px wide):**
```
┌────┐
│ ☰  │   ← Toggle button
│    │
│ 3  │   ← Pending count badge
│    │
│    │
│    │
└────┘
```

**Expanded (280px wide):**
```
┌────────────────────────────────────┐
│ ◀  Tasks               Window 1   │  ← Header
├────────────────────────────────────┤
│ ● Running tests...                 │  ← in_progress (cyan)
│ ○ Fix type errors                  │  ← pending (gray)
│ ○ Update documentation             │  ← pending
│ ✓ Install dependencies             │  ← completed (green, dim)
│ ✓ Read codebase                    │  ← completed
└────────────────────────────────────┘
```

### Status Indicators

| Status       | Icon | Color              | Opacity |
|--------------|------|--------------------|---------|
| pending      | ○    | --text-secondary   | 1.0     |
| in_progress  | ●    | --accent-cyan      | 1.0     |
| completed    | ✓    | --success-green    | 0.6     |

---

## Styling

```css
/* src/client/styles/todo-panel.css */

.todo-panel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(10, 10, 15, 0.85);
  backdrop-filter: blur(12px);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  transition: width 200ms ease-out;
  z-index: 100;
}

.todo-panel--collapsed {
  width: 48px;
}

.todo-panel--expanded {
  width: 280px;
}

.todo-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.4;
}

.todo-item--pending {
  color: #a1a1aa;
}

.todo-item--in-progress {
  color: #00d4ff;
}

.todo-item--completed {
  color: #22c55e;
  opacity: 0.6;
}

.todo-badge {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 212, 255, 0.2);
  color: #00d4ff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}
```

---

## App.tsx Layout Integration

### Current Layout (simplified)
```tsx
<div className="flex h-screen">
  <SplitView
    sidePanelOpen={sidePanelOpen}
    minimapVisible={minimapVisible}
    // ... positioned with rightOffset
  />
  {sidePanelOpen && <SidePanel />}
  {minimapVisible && <TerminalMinimap />}
</div>
```

### New Layout
```tsx
<div className="flex h-screen">
  <TodoPanel
    expanded={todoPanelExpanded}
    onToggle={() => setTodoPanelExpanded(!todoPanelExpanded)}
    activeWindowId={activeWindowId}
    windows={windows}
  />
  <SplitView
    leftOffset={todoPanelExpanded ? 280 : 48}  // NEW
    sidePanelOpen={sidePanelOpen}
    minimapVisible={minimapVisible}
  />
  {sidePanelOpen && <SidePanel />}
  {minimapVisible && <TerminalMinimap />}
</div>
```

### SplitView.tsx Modifications

```tsx
// Add leftOffset prop
interface SplitViewProps {
  // ... existing props
  leftOffset?: number;  // NEW
}

// Modify container positioning
<div
  ref={containerRef}
  className="absolute bg-[#0a0a0f]"
  style={{
    top: 0,
    left: leftOffset,      // NEW (was 0)
    bottom: 0,
    right: rightOffset
  }}
>
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Server)
**Files:** `src/server/todo/`, `src/shared/todoProtocol.ts`

1. Create `TodoManager.ts` - Central state management per window
2. Create `TodoFileWatcher.ts` - Watch `.claude-todos.json` per window
3. Add WebSocket handlers for todo:subscribe/unsubscribe
4. Integrate with ConnectionManager for broadcasts

**Estimated scope:** ~300 lines

### Phase 2: Client Components
**Files:** `src/client/components/TodoPanel/`, `src/client/hooks/useTodoSync.ts`

1. Create `TodoPanel.tsx` - Collapsible container
2. Create `TodoItem.tsx` - Status indicator + text
3. Create `TodoList.tsx` - Scrollable list with animations
4. Create `useTodoSync.ts` - WebSocket subscription hook

**Estimated scope:** ~400 lines

### Phase 3: App Integration
**Files:** `src/client/App.tsx`, `src/client/components/SplitView/SplitView.tsx`

1. Add TodoPanel to App.tsx layout
2. Add leftOffset prop to SplitView
3. Add state for todoPanelExpanded
4. Connect activeWindowId for window switching
5. Add CSS file import

**Estimated scope:** ~50 lines of modifications

### Phase 4: Output Parser (Enhancement)
**Files:** `src/server/todo/TodoOutputParser.ts`

1. Create parser for terminal output markers
2. Integrate with output stream
3. Handle marker detection and extraction

**Estimated scope:** ~150 lines

---

## File Changes Summary

### New Files (8)
```
src/client/components/TodoPanel/TodoPanel.tsx
src/client/components/TodoPanel/TodoItem.tsx
src/client/components/TodoPanel/TodoList.tsx
src/client/components/TodoPanel/index.ts
src/client/hooks/useTodoSync.ts
src/client/styles/todo-panel.css
src/server/todo/TodoManager.ts
src/server/todo/TodoFileWatcher.ts
src/shared/todoProtocol.ts
```

### Modified Files (4)
```
src/client/App.tsx                    # Add TodoPanel to layout
src/client/components/SplitView/SplitView.tsx  # Add leftOffset prop
src/server/index.ts                   # Initialize TodoManager
src/server/websocket/ConnectionManager.ts  # Add todo handlers
```

---

## Testing Strategy

1. **Unit Tests:**
   - TodoManager state management
   - TodoFileWatcher file detection
   - TodoItem rendering with different statuses

2. **Integration Tests:**
   - WebSocket message flow
   - Window switching todo sync
   - File watcher → UI update pipeline

3. **Manual Testing:**
   - Create terminal window, run Claude Code
   - Verify todos appear in panel
   - Test expand/collapse animation
   - Test window switching updates

---

## Keyboard Shortcuts (Optional Enhancement)

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+T` | Toggle todo panel |
| `Cmd+T` | Focus todo panel (when collapsed, also expands) |

---

## Future Enhancements

1. **Todo Filtering** - Show only pending, only in_progress, etc.
2. **Persistence** - Save todos to SQLite for session resume
3. **Manual Todos** - Allow user to add their own todos
4. **Todo History** - Show completed todos from previous sessions
5. **Sync Indicator** - Show when todos are syncing
