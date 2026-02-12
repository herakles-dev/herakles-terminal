# Zeus Terminal Handoff System Overview

## Purpose
Automate context continuation by spawning a new Zeus Terminal window with Claude Code pre-loaded and a Quick Resume prompt.

## Architecture

### Components

1. **Skill Definition** (`~/.claude/skills/handoff/SKILL.md`)
   - User-facing trigger for `/handoff` command
   - Defines handoff file locations and spawn protocol
   - Documents usage and arguments

2. **Spawn Script** (`~/.claude/hooks/spawn-claude-window.py`)
   - PostToolUse hook triggered when skill="handoff"
   - Communicates with Zeus Terminal API to create automations
   - Handles deduplication via file-based locking

3. **Zeus Automation System** (`src/server/automation/AutomationEngine.ts`)
   - Executes multi-step command sequences
   - Creates windows via AutomationEngine callbacks
   - Manages command delays and execution flow

4. **Window Manager** (`src/server/window/WindowManager.ts`)
   - Creates and manages Zeus terminal windows
   - Handles window lifecycle (create, attach, close)
   - Manages PTY connections and tmux sessions

5. **Connection Manager** (`src/server/websocket/ConnectionManager.ts`)
   - Broadcasts window creation events to clients
   - Manages WebSocket message routing
   - Handles window subscriptions and output

## Flow Diagram

```
User invokes /handoff
         ↓
Skill creates handoff.md (if needed)
         ↓
Skill calls spawn script directly (Bash)
         ↓
spawn-claude-window.py:
  1. Acquires lock (prevents duplicates)
  2. Finds handoff.md
  3. Extracts Quick Resume prompt
  4. Gets active Zeus session + CSRF token
  5. Creates automation via POST /api/automations
  6. Triggers automation via POST /api/automations/{id}/run
  7. Releases lock
         ↓
Zeus AutomationEngine:
  1. Receives run request
  2. Creates window (if createWindow: true)
  3. Executes steps sequentially:
     - cd /project/path
     - claude --dangerously-skip-permissions
     - <Quick Resume prompt>
     - <Enter to submit>
  4. Callbacks notify ConnectionManager
         ↓
ConnectionManager broadcasts window:created
         ↓
Client receives window, attaches PTY, restores content
```

## Known Issues

### 1. Sometimes Window Not Created
**Symptoms:** Automation runs but no window appears
**Possible Causes:**
- Race condition in AutomationEngine callback chain
- Window creation fails but no error propagated
- createWindow flag not properly honored
- WindowManager.createWindow() throwing but caught silently

### 2. CPU Usage Loops
**Symptoms:** High CPU usage after handoff
**Possible Causes:**
- Infinite retry loops in automation execution
- PTY output listeners not detached on window close
- Polling loops in spawn script (lock checks)
- setTimeout/setInterval not cleared on cleanup
- OutputPipeline buffering without backpressure

### 3. Safety Concerns
**Current Safeguards:**
- Lock file prevents duplicate spawns (10s timeout)
- CSRF token validation on API calls
- User email authorization on window operations
- Max windows per session limit (6)
- Prompt truncation (2000 chars)

**Missing Safeguards:**
- No timeout on automation execution (can hang)
- No error recovery if window creation fails
- Lock file can become stale if process crashes
- No rate limiting on spawn script calls

## File Locations

| Component | Path |
|-----------|------|
| Skill | `~/.claude/skills/handoff/SKILL.md` |
| Spawn Script | `~/.claude/hooks/spawn-claude-window.py` |
| Spawn Log | `~/.claude/hooks/handoff.log` |
| Lock File | `~/.claude/hooks/handoff.lock` |
| Handoff Files | `/home/hercules/sessions/{project}/handoff.md` |
| Automation Engine | `src/server/automation/AutomationEngine.ts` |
| Window Manager | `src/server/window/WindowManager.ts` |
| Connection Manager | `src/server/websocket/ConnectionManager.ts` |

## API Endpoints Used

```
GET  /api/sessions           # Get active session + CSRF token
POST /api/automations        # Create automation
POST /api/automations/{id}/run  # Execute automation
```

## Automation Structure

```json
{
  "sessionId": "<uuid>",
  "name": "handoff-{project}",
  "trigger": "on_resume",
  "createWindow": true,
  "windowName": "claude-{project}",
  "steps": [
    {"id": "1", "command": "cd /path", "delayAfter": 1},
    {"id": "2", "command": "claude --dangerously-skip-permissions", "delayAfter": 8},
    {"id": "3", "command": "<prompt>", "delayAfter": 1, "noNewline": true},
    {"id": "4", "command": "", "delayAfter": 0}
  ]
}
```

## Timing & Delays

- Lock timeout: 10s
- cd delay: 1s
- Claude startup delay: 8s
- Prompt send delay: 1s
- API timeout (create): 10s
- API timeout (run): 2s (fire-and-forget)

## Deduplication Strategy

1. Lock file checked before execution
2. If lock < 10s old, skip
3. Lock acquired with flock
4. Lock contains PID for debugging
5. Lock released after spawn complete

## Error Handling

**Spawn Script:**
- JSON decode errors → log + exit 0
- API errors → log + return error message
- No session → skip spawn
- No handoff.md → skip spawn

**AutomationEngine:**
- Command failures logged but don't stop sequence
- Window creation failures logged
- No retry mechanism

## Security

**Authentication:**
- Remote-User header (Authelia)
- Remote-Email header
- CSRF token via cookie

**Authorization:**
- User email verified on all window operations
- Session ownership checked
- Window ownership checked

**Input Validation:**
- Prompt truncated to 2000 chars
- Shell escape for single quotes
- Command validation (future enhancement)

## Performance Considerations

- Fire-and-forget run request (2s timeout)
- No blocking waits in spawn script
- Lock prevents thundering herd
- Automation runs async on server

## Future Improvements

1. Add automation execution timeout
2. Better error propagation from AutomationEngine
3. Stale lock cleanup on startup
4. Rate limiting on spawn attempts
5. Window creation retry with exponential backoff
6. Cleanup automations after completion
7. Health check endpoint for spawn script
8. Metrics/telemetry for spawn success rate

## Debugging

**Check spawn log:**
```bash
tail -f ~/.claude/hooks/handoff.log
```

**Check lock file:**
```bash
cat ~/.claude/hooks/handoff.lock  # Shows PID
ls -la ~/.claude/hooks/handoff.lock  # Check age
```

**Check automations:**
```bash
sqlite3 /home/hercules/herakles-terminal/data/zeus.db \
  "SELECT * FROM automations WHERE name LIKE 'handoff-%' ORDER BY created_at DESC LIMIT 5"
```

**Check server logs:**
```bash
journalctl --user -u zeus-terminal -f | grep -i automation
```

**Manual test:**
```bash
echo '{"tool_name": "Skill", "tool_input": {"skill": "handoff"}}' | \
  python3 ~/.claude/hooks/spawn-claude-window.py
```

## Related Systems

- **TodoPanel**: Shows Claude Code task progress
- **ContextIndicator**: Displays token usage per window
- **ProjectNavigator**: Quick access to projects
- **Automation System**: Command scheduling and execution

---

**Last Updated:** 2026-02-04
**Version:** 0.2.0
