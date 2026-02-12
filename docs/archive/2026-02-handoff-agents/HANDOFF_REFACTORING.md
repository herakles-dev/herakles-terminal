# Handoff System Refactoring Guide

**Version:** 1.0 | **Date:** February 2026

## Overview

This document describes the refactored handoff system with improved maintainability, error messages, and observability.

**Key improvements:**
- Modular Python classes with type hints
- User-friendly error messages with recovery actions
- Structured logging with trace IDs
- Comprehensive integration tests
- Clear separation of concerns

## Architecture

### Python Layer (`~/.claude/hooks/spawn_claude_window.py`)

```
Input (PostToolUse hook)
    ↓
HandoffHandler.handle()
    ├─ Lock (prevent duplicates)
    ├─ Input validation
    ├─ Handoff file discovery
    └─ Prompt extraction
    ↓
ZeusApiClient
    ├─ get_active_session()
    ├─ create_automation()
    └─ run_automation()
    ↓
Output (SystemMessage)
```

### TypeScript Layer (`src/server/automation/AutomationEngine.ts`)

```
AutomationEngine
    ├─ onConnect/onDisconnect/onResume handlers
    ├─ executeAutomation() with trace ID
    ├─ Metrics recording
    ├─ Callback invocation
    └─ Error handling
    ↓
WindowManager (create new window)
    ↓
Callbacks (notify external systems)
```

## Components

### HandoffLogger

Structured logging with trace IDs for debugging and observability.

```python
logger = HandoffLogger("trace-id-123", Path.home() / ".claude/hooks/handoff.log")
logger.info("Handoff started", project="my-project")
logger.error("No session found", recovery="Open Zeus Terminal")
```

**Log format:**
```
[2026-02-04T15:30:45.123456] [trace-id-123] [INFO] Message {"key": "value"}
```

### LockManager

File-based locking to prevent concurrent executions.

```python
lock_mgr = LockManager(lock_file, logger)
if lock_mgr.acquire():
    try:
        # Do work
        pass
    finally:
        lock_mgr.release()
```

**Features:**
- Non-blocking acquire (returns immediately if locked)
- Stale lock detection (>10 seconds old)
- Graceful failure handling

### HandoffPromptExtractor

Parses handoff.md files to extract Quick Resume prompts.

```python
extractor = HandoffPromptExtractor(logger)
handoff_path = extractor.find_handoff_file(project_path)
prompt = extractor.extract_quick_resume(handoff_path)
```

**Search order:**
1. `/home/hercules/sessions/{project}/handoff.md`
2. `/home/hercules/v8/.handoffs/{project}-latest.md`
3. `{project}/handoff.md`
4. `~/.claude/handoff_context.md`

**Fallback:** Returns summary if Quick Resume section not found.

### ZeusApiClient

API client with comprehensive error handling.

```python
client = ZeusApiClient("http://localhost:8096", "user", "email", logger)
session_id, csrf_token = client.get_active_session()
automation_id, error = client.create_automation(session_id, project_path, prompt)
error = client.run_automation(automation_id)
```

**Error types:**
- `NETWORK_ERROR`: Connection issues, timeouts
- `AUTOMATION_CREATE_FAILED`: API validation or server error
- `AUTOMATION_RUN_FAILED`: Execution failed
- `NO_ZEUS_SESSION`: No active session
- `NO_HANDOFF_FILE`: Handoff file not found

### HandoffHandler

Main orchestrator combining all components.

```python
handler = HandoffHandler()
result = handler.handle(input_data)
```

**Returns:**
```json
{
  "systemMessage": "Spawned Claude window: claude-{project}"
}
```

Or on error:
```json
{
  "systemMessage": "Handoff failed: {error_message}. Recovery: {recovery_action}"
}
```

## Error Messages

All errors include user-friendly messages and recovery actions.

### Examples

#### No Active Session
```
Handoff failed: No active Zeus session found.
Recovery: Open Zeus Terminal and create a session: npm run dev
```

#### Network Error
```
Handoff failed: Cannot connect to Zeus Terminal at http://localhost:8096.
Recovery: Ensure Zeus Terminal is running: npm run dev
```

#### Validation Error
```
Handoff failed: Invalid prompt: Command too long (2500 chars > 2000 max).
Recovery: Check handoff.md file is readable
```

#### Window Not Found
```
Handoff failed: No window available to run commands in.
Recovery: Open Zeus Terminal and create a new window before running automations
```

## TypeScript Improvements

### ExecutionErrorType Enum

Classification for structured error handling:

```typescript
enum ExecutionErrorType {
  DISABLED = 'DISABLED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  WINDOW_NOT_FOUND = 'WINDOW_NOT_FOUND',
  WINDOW_CREATE_FAILED = 'WINDOW_CREATE_FAILED',
  COMMAND_EXECUTION_FAILED = 'COMMAND_EXECUTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  CONCURRENCY_LIMIT = 'CONCURRENCY_LIMIT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

### ExecutionResult Interface

Comprehensive result with error details:

```typescript
interface ExecutionResult {
  success: boolean;
  windowId?: string;
  windowName?: string;
  output?: string;
  error?: {
    type: ExecutionErrorType;
    message: string;
    recovery: string;  // User-friendly recovery instructions
  };
}
```

### ExecutionMetrics Interface

Observability data for monitoring:

```typescript
interface ExecutionMetrics {
  traceId: string;
  automationId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  errorType?: ExecutionErrorType;
  errorMessage?: string;
  windowCreated: boolean;
  stepCount: number;
  completedSteps?: number;
}
```

### Callback Signature

Updated to include metrics:

```typescript
type ExecutionCallback = (
  automation: Automation,
  result: ExecutionResult,
  metrics: ExecutionMetrics
) => void;

engine.onExecution((automation, result, metrics) => {
  console.log(`Executed ${automation.id} in ${metrics.durationMs}ms`);
  if (!result.success) {
    console.error(`Error: ${result.error?.message}`);
    console.info(`Recovery: ${result.error?.recovery}`);
  }
});
```

## Logging

### Structured Logging

All logs include structured context for easy parsing:

```typescript
logger.info('Automation executed', {
  traceId: 'auto-1704067200000-abc123def',
  automationId: 'auto-handoff-test',
  duration: 2345,
  success: true,
  windowCreated: true,
});
```

### Trace ID Correlation

Every automation execution gets a unique trace ID that appears in all logs:

```
[2026-02-04T15:30:45.123456] [auto-1704067200000-abc123def] [INFO] Automation executed {"automationId": "auto-handoff-test"}
[2026-02-04T15:30:45.234567] [auto-1704067200000-abc123def] [INFO] Creating window for automation {"windowName": "claude-project"}
[2026-02-04T15:30:46.345678] [auto-1704067200000-abc123def] [INFO] Window created {"windowId": "window-123"}
[2026-02-04T15:30:46.456789] [auto-1704067200000-abc123def] [INFO] Executing command steps {"stepCount": 3}
```

## Testing

### Python Unit Tests

Run with:
```bash
python -m pytest ~/.claude/hooks/__tests__/test_spawn_claude_window.py -v
```

Tests cover:
- HandoffLogger: File creation, structured formats
- LockManager: Lock acquire/release, stale detection
- HandoffPromptExtractor: File discovery, parsing, fallbacks
- ZeusApiClient: API calls, error handling, prompt escaping
- HandoffHandler: Integration flow, error cases

### TypeScript Integration Tests

Run with:
```bash
npm test -- src/server/automation/__tests__/AutomationEngine.handoff.test.ts
```

Tests cover:
- Successful handoff flow (window creation + step execution)
- Error cases (no session, no handoff, network errors)
- Callback invocation with metrics
- Trace ID correlation
- Concurrent execution safeguards

## Integration Guide

### Deploying Changes

1. **Update spawn script** (immediate):
   ```bash
   cp ~/.claude/hooks/spawn_claude_window.py ~/.claude/hooks/spawn-claude-window.py.backup
   python -m pytest ~/.claude/hooks/__tests__/test_spawn_claude_window.py
   # Verify tests pass
   ```

2. **Update AutomationEngine.ts** (staged):
   ```bash
   # Review src/server/automation/AutomationEngine.refactored.ts
   # Merge improvements into src/server/automation/AutomationEngine.ts
   npm run typecheck
   npm test -- AutomationEngine
   npm run build
   ```

3. **Update error handling** (systemd):
   ```bash
   systemctl --user restart zeus-terminal
   curl -s http://localhost:8096/api/health | jq
   ```

### Monitoring

**Check handoff logs:**
```bash
tail -f ~/.claude/hooks/handoff.log | jq .
```

**Correlate with server logs:**
```bash
journalctl --user -u zeus-terminal -f | grep "auto-1704067200000-abc123def"
```

**API endpoint (future):**
```
GET /api/automations/{automationId}/metrics
GET /api/automations/{automationId}/logs?traceId={traceId}
```

## Migration Path

### Phase 1: Spawn Script (v0.2.0)
- Deploy refactored `spawn_claude_window.py`
- Run Python tests
- Monitor logs for trace IDs
- Verify handoff flow works

### Phase 2: AutomationEngine (v0.3.0)
- Integrate ExecutionMetrics into AutomationEngine
- Update callback signatures
- Add structured logging
- Run integration tests
- Deploy to production

### Phase 3: API & Monitoring (v0.4.0)
- Add metrics storage endpoint
- Create observability dashboard
- Log retention policies
- Performance optimization

## Troubleshooting

### Handoff fails with "No active Zeus session"
**Check:**
```bash
curl -s http://localhost:8096/api/sessions \
  -H "Remote-User: hercules" \
  -H "Remote-Email: hello@herakles.dev" | jq
```

**Fix:** Open Zeus Terminal, ensure session is active:
```bash
npm run dev
```

### Handoff fails with network error
**Check:**
```bash
curl -s http://localhost:8096/api/health | jq
```

**Fix:** Verify ZEUS_URL environment variable:
```bash
echo $ZEUS_URL
export ZEUS_URL=http://localhost:8096
```

### No automation ID returned
**Check:**
```bash
tail -f ~/.claude/hooks/handoff.log
```

**Look for:** `No automation ID in response` or HTTP error

**Fix:** Check Zeus API logs:
```bash
journalctl --user -u zeus-terminal -f
```

### Window not created
**Check:**
```bash
sqlite3 ~/.local/share/zeus-terminal/data.db \
  "SELECT id, name, state FROM windows ORDER BY created_at DESC LIMIT 5"
```

**Fix:** Verify session is active and has capacity:
```bash
sqlite3 ~/.local/share/zeus-terminal/data.db \
  "SELECT id, max_windows, (SELECT COUNT(*) FROM windows WHERE session_id = sessions.id) as window_count FROM sessions"
```

## References

- **Spawn Script:** `~/.claude/hooks/spawn_claude_window.py`
- **Tests:** `~/.claude/hooks/__tests__/test_spawn_claude_window.py`
- **AutomationEngine:** `src/server/automation/AutomationEngine.ts`
- **Refactored Version:** `src/server/automation/AutomationEngine.refactored.ts`
- **Integration Tests:** `src/server/automation/__tests__/AutomationEngine.handoff.test.ts`

## Design Decisions

### Why Classes in Python?
- Clear separation of concerns
- Type hints for better IDE support
- Testable units (can mock/patch individual classes)
- Easier to extend (e.g., add retry logic to ZeusApiClient)

### Why Trace IDs?
- Correlation across spawn script and AutomationEngine logs
- Debugging handoff failures (follow single trace through system)
- Metrics/monitoring integration (group by trace ID)

### Why Callback Metrics?
- External systems can track automation execution
- Enables handoff hook to log completion
- Foundation for future observability dashboard
- Decouples AutomationEngine from specific integrations

### Why ExecutionErrorType Enum?
- Distinguish between error types (network, validation, not found)
- Enable different retry strategies
- Metrics aggregation by error type
- Future API expansion with error-specific endpoints

## Future Enhancements

1. **Retry logic in ZeusApiClient**
   - Exponential backoff for network errors
   - Circuit breaker pattern for connection failures

2. **Metrics persistence**
   - Store metrics in SQLite for historical analysis
   - API endpoint to query execution history

3. **Advanced error recovery**
   - Automatic retry for transient failures
   - Fallback automation if primary fails

4. **Observability dashboard**
   - Real-time automation execution stats
   - Error rate tracking
   - Performance trending

5. **Rate limiting**
   - Per-user handoff rate limits
   - Prevent spawn script from flooding Zeus with automations

6. **Handoff context persistence**
   - Store project context (stack, recent commits, etc.)
   - Resume from specific checkpoint
