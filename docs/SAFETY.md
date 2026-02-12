# Safety Safeguards for Handoff System

## Overview

The handoff system includes comprehensive safety mechanisms to prevent resource exhaustion, infinite loops, and cascading failures. This document details all safety limits, recovery procedures, and monitoring.

---

## Safety Limits

### 1. Rate Limiting

#### Python Spawn Script (`~/.claude/hooks/spawn-claude-window.py`)

**Rate Limit Tracking:**
- **File**: `~/.claude/hooks/handoff_rate.json`
- **Max calls per minute**: 5 per user
- **Failure cooldown**: 30 seconds after exceeding limit
- **Rapid-fire detection**: 10 second minimum between calls (detects loops)
- **Stale entry cleanup**: 2 minutes old entries removed automatically
- **Lock file age limit**: 5 minutes (files older than this are cleaned up)

**Rate Limit Logic:**

```python
# Allowed if:
1. Not in cooldown period
2. Fewer than 5 calls in last 60 seconds
3. Not a rapid-fire call (>10s since last call)

# Triggers cooldown if:
1. 5 calls made in 60s window
2. Call made within 10s of previous (potential loop)
3. Handoff creation fails
```

**Recovery:**
```bash
# Check rate limit status
cat ~/.claude/hooks/handoff_rate.json

# Manually reset rate limits (use with caution)
rm ~/.claude/hooks/handoff_rate.json

# View handoff hook logs
tail -100 ~/.claude/hooks/handoff.log
```

#### Server HTTP Endpoint (`/api/automations/:id/run`)

**Rate Limit:**
- **Limit**: 5 handoff calls per minute per user
- **Window**: 60 seconds
- **Lockout**: 5 minutes after exceeding limit
- **Storage**: SQLite `rate_limits` table
- **Key**: `handoff:{remote-user}@{ip-address}`

**Response Headers:**
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 1640000000  # Unix timestamp
```

**Error Response (429 Too Many Requests):**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests, please try again later",
    "retryAfter": 45  // seconds to wait before retrying
  }
}
```

---

### 2. Execution Timeouts

#### AutomationEngine Timeout (`src/server/automation/AutomationEngine.ts`)

**Max Execution Time**: 30 seconds per automation

**How It Works:**
```typescript
// New method: executeWithTimeout()
// Wraps executeAutomation() with Promise.race()
// Kills execution if timeout exceeded
const result = await Promise.race([
  executeAutomation(...),
  timeout(30000)  // 30 second limit
]);
```

**Timeout Handling:**
1. Execution aborted at 30 second mark
2. Resources cleaned up in finally block
3. Error returned: `{ success: false, error: 'EXECUTION_TIMEOUT' }`
4. User concurrency count decremented
5. Automation removed from running set

**Per-Step Delays:**
- Each step's `delayAfter` is respected
- Total time budget = 30 seconds (sum of all delays + execution time)
- Example: If 3 steps with 8s delays each, automation times out after ~24s

---

### 3. Concurrency Limits

#### Per-User Concurrent Automations

**Limit**: 10 concurrent automations per user

**Enforcement:**
- Checked before execution starts
- Tracked in `userConcurrencyCount` Map
- Incremented when execution begins
- Decremented when execution completes (in finally block)

**Error Response:**
```json
{
  "success": false,
  "output": "Maximum 10 concurrent automations per user exceeded...",
  "error": "CONCURRENCY_LIMIT_EXCEEDED"
}
```

**Check Concurrency:**
```bash
# Via logs
tail -f /tmp/zeus-terminal.log | grep "concurrency"

# Via API (check running automations for user)
curl http://localhost:8096/api/automations
```

---

### 4. Resource Limits

#### Lock File Management

**Lock File**: `~/.claude/hooks/handoff.lock`

**Cleanup:**
- Automatic cleanup on script startup if older than 5 minutes
- Prevents stale locks from blocking all handoffs
- Manual cleanup: `rm ~/.claude/hooks/handoff.lock`

**Lock Acquisition:**
```python
# Reuses existing lock if <10 seconds old (deduplication)
# Creates new lock if >10 seconds old (stale cleanup)
# Blocks if lock exists and <10 seconds old (prevents duplicates)
```

#### Database Cleanup

**Rate Limit Records:**
- Auto-cleanup of records older than 24 hours
- Triggered on first rate limit check after 24h
- Query: `DELETE FROM rate_limits WHERE updated_at < cutoff_time`

**Automation Logs:**
- Kept in `automation_logs` table indefinitely
- Recommended cleanup policy:
  ```sql
  -- Keep last 90 days of logs
  DELETE FROM automation_logs WHERE triggered_at < datetime('now', '-90 days');
  ```

---

## Error Recovery

### Failure Scenarios

#### 1. Handoff Script Fails

**Symptoms:**
- `systemMessage` returned with error
- User sees "Handoff hook error: ..."
- Log entry in `~/.claude/hooks/handoff.log`

**Recovery:**
```bash
# 1. Check rate limit status
cat ~/.claude/hooks/handoff_rate.json

# 2. View error logs
tail -50 ~/.claude/hooks/handoff.log

# 3. If rate limited, wait or reset
# Wait 30-300 seconds (depends on failure type)

# 4. Check Zeus server health
curl http://localhost:8096/api/health | jq

# 5. Check active sessions
curl -H "Remote-User: hercules" http://localhost:8096/api/sessions
```

#### 2. Automation Execution Timeout

**Symptoms:**
- Automation partially completes
- Error: `{ error: 'EXECUTION_TIMEOUT' }`
- Window created but no commands executed

**Recovery:**
```bash
# 1. Check automation logs
sqlite3 data/zeus.db "SELECT * FROM automation_logs ORDER BY triggered_at DESC LIMIT 10"

# 2. Verify window was created
curl http://localhost:8096/api/sessions/SESSION_ID/windows

# 3. Manually complete remaining steps
# Connect to terminal and continue

# 4. Check timeout limit
# Current: 30 seconds (MAX_EXECUTION_TIME_MS)
```

#### 3. Concurrency Limit Exceeded

**Symptoms:**
- Error: `CONCURRENCY_LIMIT_EXCEEDED`
- New automation not queued

**Recovery:**
```bash
# 1. Wait for current automations to complete
# OR
# 2. Cancel running automations
curl -X POST http://localhost:8096/api/automations/AUTO_ID/cancel

# 3. Check which automations are running
sqlite3 data/zeus.db "
  SELECT id, name, created_at FROM automation_logs
  WHERE success = 0 AND triggered_at > datetime('now', '-5 minutes')
  ORDER BY triggered_at DESC
"
```

#### 4. Rapid-Fire Loop Detection

**Symptoms:**
- Rate limiter blocks call with <10s between attempts
- Error: `"Rapid fire call detected: X.Xs since last call (potential loop)"`
- 30 second cooldown imposed

**Recovery:**
```bash
# 1. Stop triggering handoffs
# 2. Wait 30 seconds (or clear rate file)
# 3. Check for infinite loop in Claude code:
#    - Verify handoff logic isn't recursive
#    - Check for automatic re-triggering

# 4. Review recent logs
tail -20 ~/.claude/hooks/handoff.log | grep -i "rapid\|loop"
```

---

## Monitoring

### Health Checks

```bash
# Python script rate limiting
jq '.[] | select(.failure_count > 2)' ~/.claude/hooks/handoff_rate.json

# Server concurrency levels
sqlite3 data/zeus.db "
  SELECT user_email, COUNT(*) as running_count
  FROM running_automations
  GROUP BY user_email
"

# Timeout occurrences
sqlite3 data/zeus.db "
  SELECT COUNT(*) as timeout_count
  FROM automation_logs
  WHERE output LIKE '%timeout%'
  AND triggered_at > datetime('now', '-1 hour')
"

# Rate limit hits
sqlite3 data/zeus.db "
  SELECT key, count, window_start FROM rate_limits
  WHERE key LIKE 'handoff:%'
"
```

### Alerting Recommendations

**Alert if:**
1. Same user exceeds rate limit >3 times in 1 hour
2. Automation timeouts >20% of execution attempts in 1 hour
3. Average concurrency count >5 per user
4. Lock file exists >5 minutes (stale lock warning)

**Example Alert Thresholds:**
```yaml
alerts:
  - name: "Handoff rate limit abuse"
    query: "count(rate_limit_hits) > 3 per user in 1h"
    severity: warning

  - name: "High automation timeout rate"
    query: "timeout_count / total_count > 0.2 in 1h"
    severity: critical

  - name: "User concurrency spike"
    query: "concurrent_count > 8 per user"
    severity: warning

  - name: "Stale lock file"
    query: "handoff.lock mtime > 5m"
    severity: warning
```

### Logging

**Log Locations:**
- Python script: `~/.claude/hooks/handoff.log`
- Server logs: `/tmp/zeus-terminal.log` (symlink or stdout)
- Database logs: SQLite `automation_logs` table

**Log Levels:**
- INFO: Normal handoff execution
- WARNING: Rate limits applied, timeouts, concurrency limits
- ERROR: Failures, exceptions, validation errors

**Log Entry Examples:**
```
[2026-02-04T12:34:56] Handoff hook: Rate limit check passed
[2026-02-04T12:34:57] Creating automation...
[2026-02-04T12:34:57] POST http://localhost:8096/api/automations
[2026-02-04T12:34:58] Create response: 201
[2026-02-04T12:34:58] SUCCESS: Spawned claude-herakles-terminal

[2026-02-04T12:35:05] BLOCKED: Rate limit exceeded: 5 calls in last 60s (max 5)

[2026-02-04T12:35:06] Rapid fire call detected: 0.9s since last call (potential loop)
```

---

## Configuration

### Adjusting Safety Limits

#### Python Script (`~/.claude/hooks/spawn-claude-window.py`)

```python
# Edit these constants at top of file:
MAX_CALLS_PER_MINUTE = 5
FAILURE_COOLDOWN_SECONDS = 30
MAX_LOCK_AGE_SECONDS = 300  # 5 minutes
```

#### AutomationEngine (`src/server/automation/AutomationEngine.ts`)

```typescript
// Edit these class constants:
MAX_EXECUTION_TIME_MS = 30 * 1000;        // 30 seconds
MAX_CONCURRENT_PER_USER = 10;             // 10 concurrent
STEP_TIMEOUT_MULTIPLIER = 1.5;            // 50% buffer
```

#### Middleware (`src/server/middleware/rateLimit.ts`)

```typescript
// Edit handoffLimiter config:
limit: 5,                    // Max calls
windowMs: 60 * 1000,        // Time window (ms)
lockoutMinutes: 5           // Lockout duration
```

---

## Testing Safety Mechanisms

### Test Rate Limiting

```bash
# Trigger 6 handoffs rapidly (should fail on 6th)
for i in {1..6}; do
  curl -X POST http://localhost:8096/api/automations/TEST_ID/run
  echo "Call $i"
done

# 6th call should return 429 Too Many Requests
```

### Test Execution Timeout

```bash
# Create automation with long delay (>30s total)
curl -X POST http://localhost:8096/api/automations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "slow-automation",
    "steps": [
      {"id": "1", "command": "echo start", "delayAfter": 35}
    ]
  }'

# Should timeout after 30 seconds
```

### Test Concurrency Limit

```bash
# Trigger 11 automations rapidly
for i in {1..11}; do
  curl -X POST http://localhost:8096/api/automations \
    -H "Content-Type: application/json" \
    -d '{"name": "concurrent-test-'$i'"}' &
done
wait

# 11th should fail with CONCURRENCY_LIMIT_EXCEEDED
```

---

## Disaster Recovery

### Complete Reset (Use with Caution)

```bash
# 1. Stop Zeus Terminal
systemctl --user stop zeus-terminal

# 2. Clear rate limits and locks
rm -f ~/.claude/hooks/handoff_rate.json
rm -f ~/.claude/hooks/handoff.lock

# 3. Clear automation logs (optional)
sqlite3 data/zeus.db "DELETE FROM automation_logs"

# 4. Clear running automation state
sqlite3 data/zeus.db "DELETE FROM running_automations"

# 5. Restart
systemctl --user start zeus-terminal

# 6. Verify health
curl http://localhost:8096/api/health | jq
```

### Manual Lock Cleanup

```bash
# If lock file is preventing all handoffs:
rm ~/.claude/hooks/handoff.lock

# Or force cleanup (recommended)
# Lock will auto-cleanup on next handoff attempt if >5 min old
```

### Database Corruption Recovery

```bash
# Check database integrity
sqlite3 data/zeus.db "PRAGMA integrity_check;"

# If corrupted, rebuild
cp data/zeus.db data/zeus.db.backup
sqlite3 data/zeus.db "VACUUM;"

# If still broken, restore from backup
mv data/zeus.db.backup data/zeus.db
```

---

## Performance Impact

### Overhead Per Handoff

- **Rate limit check**: ~2-5ms (JSON file read)
- **Execution timeout setup**: ~1ms (Promise.race)
- **Concurrency tracking**: <1ms (Map operation)
- **Database logging**: ~10-20ms (SQLite insert)

**Total**: ~15-30ms overhead per handoff

### Memory Usage

- **Rate limit Map**: ~1KB per active user (100 users = 100KB)
- **Execution timeouts Map**: ~100B per running automation (10 automations = 1KB)
- **Concurrency count Map**: ~50B per user (100 users = 5KB)

**Total**: Negligible (<1MB for 1000 users)

---

## References

- **Rate Limiting**: `src/server/middleware/rateLimit.ts`
- **Automation Engine**: `src/server/automation/AutomationEngine.ts`
- **Spawn Script**: `~/.claude/hooks/spawn-claude-window.py`
- **Database Schema**: `src/server/session/SessionStore.ts`
- **API Routes**: `src/server/api/automations.ts`
