# Claude Code Task System Comparison

**Date:** January 2026
**Claude Code Version:** 2.1.19
**Zeus Terminal Version:** 0.2.0

## Executive Summary

Claude Code underwent a major task management overhaul in version 2.1.16 (January 22, 2025), introducing:
- New task management system with **dependency tracking**
- Enhanced TodoWrite capabilities
- TaskCreate, TaskUpdate, TaskGet, TaskList tools
- Backwards compatibility flag (`CLAUDE_CODE_ENABLE_TASKS=false`)

Our implementation is **currently aligned with the legacy TodoWrite format** but missing the new dependency tracking features.

---

## Claude Code Task System Evolution

### Legacy System (Pre-2.1.16)
**Simple TodoWrite** - Plain array of todos with basic status tracking

### New System (2.1.16+)
**Enhanced Task Management** - Dependency tracking, blocking relationships, task ownership

---

## Current File Format Comparison

### What We Support (Legacy Format)
```json
[
  {
    "content": "Task description",
    "status": "pending" | "in_progress" | "completed",
    "activeForm": "Present continuous form shown during work"
  }
]
```

**Location:** `~/.claude/todos/{session-id}.json`

### What Claude Code 2.1.16+ Supports (New Format)
```json
[
  {
    "id": "task-1-unique-identifier",
    "subject": "Brief task title (imperative form)",
    "description": "Detailed description with acceptance criteria",
    "activeForm": "Present continuous form (e.g., 'Running tests')",
    "status": "pending" | "in_progress" | "completed",
    "owner": "agent-id or null",
    "blocks": ["task-2", "task-3"],        // NEW: Tasks blocked by this one
    "blockedBy": ["task-0"],               // NEW: Tasks blocking this one
    "metadata": { /* arbitrary data */ },  // NEW: Custom metadata
    "createdAt": 1706198400000,
    "updatedAt": 1706198400000
  }
]
```

**New Fields:**
- `id` - Unique identifier for dependency references
- `subject` - Separate from description (imperative vs descriptive)
- `owner` - Task assignment to specific agents
- `blocks` / `blockedBy` - Dependency tracking
- `metadata` - Extensible data storage

---

## API Comparison

### Claude Code 2.1.16+ Tools

| Tool | Purpose | Token Count |
|------|---------|-------------|
| **TodoWrite** | Create/update task lists | 2,167 tokens |
| **TaskCreate** | Create individual tasks | 558 tokens |
| **TaskUpdate** | Update task status/fields | ~400 tokens |
| **TaskGet** | Retrieve task details | ~300 tokens |
| **TaskList** | List all tasks with filters | ~350 tokens |

### Our Implementation

| Component | Purpose | Status |
|-----------|---------|--------|
| **TodoFileWatcher** | Monitor `~/.claude/todos/` | ✅ Working |
| **TodoManager** | Broadcast to WebSockets | ✅ Working |
| **TodoPanel** | Display tasks in UI | ✅ Working |
| **parseTodosFromFile()** | Parse legacy format | ✅ Working |

**Missing:** Dependency tracking, task ownership, metadata support

---

## Key Behavioral Changes

### 1. Dependency Tracking (NEW in 2.1.16)
Claude Code can now define task dependencies:
```typescript
// Example: Task 2 cannot start until Task 1 completes
TaskCreate({
  subject: "Run tests",
  blockedBy: ["build-task-id"]  // Must wait for build
})
```

**Our Implementation:** ❌ Not supported
- We parse tasks as independent items
- No blocking relationships displayed
- UI shows all tasks regardless of dependencies

### 2. Task Assignment (NEW)
Tasks can be assigned to specific agents:
```json
{
  "subject": "Deploy service",
  "owner": "agent-deployment-123"
}
```

**Our Implementation:** ❌ Not supported
- No owner field parsed
- All tasks shown equally

### 3. Task Lifecycle Management

**Claude Code 2.1.16+:**
- Uses `TaskCreate` to add tasks
- Uses `TaskUpdate` to modify status
- Dependency resolution prevents premature starts
- Tasks auto-transition based on blockers

**Our Implementation:**
- Passive file watcher
- Displays whatever Claude writes
- No lifecycle enforcement

### 4. Multi-Agent Coordination (NEW)

**Claude Code:**
- Task tool launches sub-agents
- Sub-agents can have their own task lists
- Parent coordinates child agent tasks

**Our Implementation:**
- Shows all sessions' tasks
- No hierarchical relationships
- Session-based grouping only

---

## Performance Optimizations

### Our Recent Improvements (January 2026)

```typescript
// OLD: Processed all 3,284 files
readdirSync(CLAUDE_TODOS_DIR).filter(f => f.endsWith('.json'))

// NEW: Filter to recent 48 hours, limit to 20 files
const RECENCY_THRESHOLD_MS = 48 * 60 * 60 * 1000;
const files = readdirSync(CLAUDE_TODOS_DIR)
  .filter(f => (now - stats.mtimeMs) < RECENCY_THRESHOLD_MS)
  .slice(0, 20);
```

**Impact:**
- 3,284 → 20 files processed
- ~50ms processing time (down from ~2000ms)
- Top 10 active sessions displayed

---

## Migration Path

### Phase 1: Add New Fields (Non-Breaking) ✅ RECOMMENDED
```typescript
// Extend parseTodosFromFile() to support new format
export function parseTodosFromFile(content: string): TodoItem[] | null {
  const parsed = JSON.parse(content);

  if (Array.isArray(parsed)) {
    return parsed.map((todo, index) => ({
      // Legacy fields (maintain compatibility)
      id: todo.id || createTodoId(todo.content || '', index),
      content: todo.content || todo.subject || '',
      activeForm: todo.activeForm || todo.content || '',
      status: todo.status || 'pending',
      createdAt: todo.createdAt || now,
      updatedAt: todo.updatedAt || now,

      // NEW fields (gracefully degrade if missing)
      subject: todo.subject,
      description: todo.description,
      owner: todo.owner,
      blocks: todo.blocks || [],
      blockedBy: todo.blockedBy || [],
      metadata: todo.metadata || {},
    }));
  }
}
```

### Phase 2: Update UI to Show Dependencies 🎯 NEXT STEP
```tsx
// TodoSection.tsx enhancement
{todo.blockedBy && todo.blockedBy.length > 0 && (
  <div className="text-[9px] text-yellow-500 mt-1">
    🔒 Blocked by {todo.blockedBy.length} task(s)
  </div>
)}

{todo.blocks && todo.blocks.length > 0 && (
  <div className="text-[9px] text-cyan-500 mt-1">
    🔗 Blocking {todo.blocks.length} task(s)
  </div>
)}
```

### Phase 3: Task Graph Visualization (Optional)
- Dependency graph view
- Topological sort display
- Critical path highlighting

---

## Backwards Compatibility

Claude Code 2.1.19 includes:
```bash
CLAUDE_CODE_ENABLE_TASKS=false claude
```

This environment variable **disables the new task system** and reverts to legacy TodoWrite.

**Our Implementation:** Fully compatible with both modes
- Legacy format: ✅ Works perfectly
- New format: ⚠️ Displays but ignores new fields

---

## Recommendations

### Immediate (Week 1)
1. ✅ **DONE:** Optimize file processing (3,284 → 20 files)
2. ✅ **DONE:** Fix reconnection bug (todoSubscribedRef reset)
3. 🎯 **TODO:** Extend `TodoItem` interface to include new fields
4. 🎯 **TODO:** Update `parseTodosFromFile()` to handle new format

### Short-term (Week 2-3)
5. 🎯 Add dependency indicators in UI (blocked/blocking badges)
6. 🎯 Show task owner when present
7. 🎯 Implement task filtering by status and owner
8. 🎯 Add metadata display tooltip

### Long-term (Month 2+)
9. Task dependency graph visualization
10. Integration with Zeus Terminal automation engine
11. Cross-service task coordination
12. Task templates and presets

---

## Sources

- [Claude Code Changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- [Claude Code Releases - v2.1.16](https://github.com/anthropics/claude-code/releases)
- [Claude API - Todo Lists Documentation](https://platform.claude.com/docs/en/agent-sdk/todo-tracking)
- [Medium: Claude Code Tasks Are Here](https://medium.com/@joe.njenga/claude-code-tasks-are-here-new-update-turns-claude-code-todos-to-tasks-a0be00e70847)
- [Claude Code System Prompts Repository](https://github.com/Piebald-AI/claude-code-system-prompts)
- [ClaudeLog - Configuration Guide](https://claudelog.com/configuration/)

---

## Testing New Format

To test with the new task format, create a task in the current Claude session:

```bash
# In this Claude Code window
TaskCreate({
  subject: "Test dependency tracking",
  description: "Verify Zeus Terminal can display new task format",
  activeForm: "Testing new format",
  status: "in_progress"
})
```

Then check: `~/.claude/todos/b1d877eb-2397-4731-8448-7a6198ce987c-agent-b1d877eb-2397-4731-8448-7a6198ce987c.json`

---

**Last Updated:** January 25, 2026
**Next Review:** When implementing Phase 2 dependency UI
