# Zeus Terminal - Debugging Guide for Claude Code

**Version:** 1.0.0  
**Last Updated:** December 17, 2025  
**Purpose:** Machine-readable debugging reference for AI-assisted development

---

## Table of Contents

1. [Logging Architecture](#logging-architecture)
2. [Log Correlation Strategies](#log-correlation-strategies)
3. [Common Issues & Resolution](#common-issues--resolution)
4. [Debugging Workflows](#debugging-workflows)
5. [Log Query Recipes](#log-query-recipes)
6. [Performance Debugging](#performance-debugging)
7. [WebSocket Debugging](#websocket-debugging)
8. [Tmux Debugging](#tmux-debugging)

---

## Logging Architecture

### Server-Side Logging Stack

```
User Request
    │
    ├──> HTTP Request
    │       └──> httpLogger (Winston) → logger.info('HTTP Request', {method, url, status, duration, userEmail, ip})
    │       └──> Loki (if enabled) → {app: "zeus-terminal", environment: "production"}
    │       └──> Console (colored in dev, JSON in prod)
    │
    ├──> WebSocket Connection
    │       └──> wsLogger (Winston child) → logger.child({component: 'websocket'})
    │       └──> AuditLogger → SessionStore.logAudit() → SQLite audit_log table
    │
    ├──> Database Operation
    │       └──> dbLogger (Winston child) → logger.child({component: 'database'})
    │
    ├──> Tmux Operation
    │       └──> tmuxLogger (Winston child) → logger.child({component: 'tmux'})
    │
    └──> Authentication
            └──> authLogger (Winston child) → logger.child({component: 'auth'})
            └──> AuditLogger.logAuthSuccess/logAuthFailure()
```

### Client-Side Logging (Minimal)

```
Component Error/Warning
    └──> console.warn() or console.error()
    └──> Example: TerminalView fit failures
```

**Rationale:** Client is presentation layer - all business logic logged server-side.

---

## Log Correlation Strategies

### 1. Trace User Journey by Email

**Goal:** Follow a specific user's actions across all components.

**Method:**
```bash
# Loki query
{app="zeus-terminal"} |~ "user@example.com"

# Local Winston logs
grep '"userEmail":"user@example.com"' logs/combined.log | jq .

# Audit log
sqlite3 data/zeus.db "SELECT * FROM audit_log WHERE user_email = 'user@example.com' ORDER BY timestamp DESC LIMIT 20"
```

**What you'll see:**
- HTTP requests with userEmail in metadata
- WebSocket auth success
- Session creation/resume
- Window operations
- Command history
- Automation execution

---

### 2. Trace Session Lifecycle by Session ID

**Goal:** Debug a specific session's behavior.

**Method:**
```bash
# Audit log (most comprehensive)
sqlite3 data/zeus.db "SELECT * FROM audit_log WHERE session_id = '<session-id>' ORDER BY timestamp"

# Winston logs
grep '<session-id>' logs/combined.log | jq .

# Loki query
{app="zeus-terminal"} |~ "<session-id>"
```

**Events to look for:**
1. `session.create` - session initialized
2. `window.create` - main terminal window created
3. `session.resume` - session reactivated
4. `auth.success` - user authenticated for session
5. `session.terminate` - session ended

---

### 3. Trace WebSocket Connection by Connection ID

**Goal:** Debug WebSocket issues for a specific connection.

**Method:**
```bash
# Find connection ID in logs
grep 'WebSocket connected' logs/combined.log | jq -r '.connectionId'

# Trace all messages for that connection
grep '<connection-id>' logs/combined.log | jq .
```

**Events to look for:**
- Connection established
- Message rate limiting (if present)
- Invalid message format errors
- Connection timeout
- Disconnect event

---

### 4. Correlate Errors Across Components

**Goal:** Find root cause of cascading failures.

**Method:**
```bash
# Get all errors in time window
sqlite3 data/zeus.db "SELECT timestamp, level, event, details FROM audit_log WHERE level = 'error' AND timestamp > datetime('now', '-1 hour')"

# Winston error logs
grep '"level":"error"' logs/combined.log | jq .

# Loki query (last hour)
{app="zeus-terminal", level="error"} [1h]
```

**Look for:**
- Timestamp correlation (errors within seconds)
- Component propagation (tmux error → websocket error → client timeout)
- User impact (how many users affected)

---

### 5. Trace Command Execution

**Goal:** See what commands a user ran and when.

**Method:**
```bash
# Command history for user
sqlite3 data/zeus.db "SELECT timestamp, session_id, window_id, command FROM command_history WHERE user_email = 'user@example.com' ORDER BY timestamp DESC LIMIT 50"

# Command history for session
sqlite3 data/zeus.db "SELECT timestamp, command FROM command_history WHERE session_id = '<session-id>' ORDER BY timestamp"
```

**Use cases:**
- User reports error after running command
- Audit user actions
- Reproduce issue by re-running command sequence

---

## Common Issues & Resolution

### Issue: "Session not found or access denied"

**Symptoms:**
- User clicks resume session
- Receives error message
- Session appears in list but can't access

**Debugging:**
```bash
# Check if session exists
sqlite3 data/zeus.db "SELECT * FROM sessions WHERE id = '<session-id>'"

# Check session ownership
sqlite3 data/zeus.db "SELECT id, user_email, state FROM sessions WHERE id = '<session-id>'"

# Check audit log
sqlite3 data/zeus.db "SELECT * FROM audit_log WHERE session_id = '<session-id>' ORDER BY timestamp DESC LIMIT 5"
```

**Common causes:**
1. Session state = 'terminated'
2. user_email mismatch (different auth)
3. Session doesn't exist in database

**Resolution:**
- If terminated: User must create new session
- If email mismatch: Check Authelia authentication
- If missing: Database corruption or session was deleted

---

### Issue: "WebSocket keeps reconnecting"

**Symptoms:**
- ConnectionStatus shows "reconnecting"
- Frequent disconnects/reconnects
- Terminal freezes periodically

**Debugging:**
```bash
# Check heartbeat failures
docker logs zeus-terminal | grep "timed out"

# Check WebSocket errors
grep '"component":"websocket"' logs/combined.log | grep '"level":"error"' | jq .

# Check system resources
docker stats zeus-terminal

# Check nginx logs
sudo tail -100 /var/log/nginx/zeus.herakles.dev.error.log
```

**Common causes:**
1. Heartbeat timeout (client not sending ping)
2. Network instability (mobile switch between WiFi/cellular)
3. nginx reverse proxy timeout
4. Server overload (high CPU/memory)

**Resolution:**
- Heartbeat: Check client ping interval (should be < 30s)
- Network: Expected on mobile - auto-reconnect should work
- nginx: Increase proxy_read_timeout in nginx config
- Resources: Scale server or optimize code

---

### Issue: "Terminal not responding to input"

**Symptoms:**
- User types but nothing appears
- Commands don't execute
- Terminal appears frozen

**Debugging:**
```bash
# Check if window exists
sqlite3 data/zeus.db "SELECT * FROM windows WHERE id = '<window-id>'"

# Check tmux pane
tmux list-panes -t zeus-<session-id> -F "#{pane_id} #{pane_active}"

# Check device lock
# (Device lock is in-memory, check logs)
docker logs zeus-terminal | grep "lock-acquired"

# Check recent window input
sqlite3 data/zeus.db "SELECT * FROM command_history WHERE window_id = '<window-id>' ORDER BY timestamp DESC LIMIT 5"
```

**Common causes:**
1. Soft lock held by other device (2s duration)
2. Tmux pane doesn't exist
3. PTY not attached
4. WebSocket message not reaching server

**Resolution:**
- Soft lock: Wait 2 seconds, should auto-release
- Tmux: Recreate window
- PTY: Reconnect WebSocket
- Message: Check browser console for WebSocket errors

---

### Issue: "Minimap not showing"

**Symptoms:**
- Minimap icon clicked but nothing appears
- Minimap blank/empty

**Debugging:**
```bash
# Check browser console
# Open DevTools → Console → look for errors

# Check terminal buffer
# If buffer is empty, minimap will be empty too

# Check XTerm initialization
# Look for "terminal not initialized" errors
```

**Common causes:**
1. Terminal not initialized yet
2. Empty buffer (no output)
3. Side panel overlapping (responsive width issue)
4. Component rendering error

**Resolution:**
- Wait for terminal to initialize
- Run a command to generate output
- Close side panel
- Check browser console for React errors

---

### Issue: "Automation not triggering"

**Symptoms:**
- Cron automation doesn't run at scheduled time
- Output trigger doesn't match expected pattern

**Debugging:**
```bash
# Check automation definition
sqlite3 data/zeus.db "SELECT * FROM automations WHERE id = '<automation-id>'"

# Check audit log for automation events
sqlite3 data/zeus.db "SELECT * FROM audit_log WHERE event LIKE 'automation.%' AND details LIKE '%<automation-id>%' ORDER BY timestamp DESC"

# Check cron initialization
docker logs zeus-terminal | grep "Initialized cron"

# For output triggers, check output content
# (Output monitoring is real-time, check logs for trigger matches)
docker logs zeus-terminal | grep "Automation triggered"
```

**Common causes:**
1. Cron syntax error
2. Trigger regex doesn't match output
3. Automation disabled
4. Session not active

**Resolution:**
- Validate cron syntax: Use crontab.guru
- Test regex: Use regex101.com
- Check enabled flag in database
- Ensure session is active (state = 'active')

---

## Debugging Workflows

### Workflow 1: User Reports "Terminal Stopped Working"

**Steps:**

1. **Identify user and session:**
   ```bash
   # Get user's sessions
   sqlite3 data/zeus.db "SELECT id, name, state, last_active_at FROM sessions WHERE user_email = 'user@example.com' ORDER BY last_active_at DESC"
   ```

2. **Check recent errors:**
   ```bash
   # Audit log errors
   sqlite3 data/zeus.db "SELECT timestamp, event, details FROM audit_log WHERE user_email = 'user@example.com' AND level = 'error' ORDER BY timestamp DESC LIMIT 10"
   
   # Winston errors
   grep '"userEmail":"user@example.com"' logs/combined.log | grep '"level":"error"' | jq .
   ```

3. **Check WebSocket status:**
   ```bash
   # Active connections
   curl http://localhost:8096/api/metrics | grep 'zeus_websocket_connections'
   
   # Recent disconnects
   docker logs --since 10m zeus-terminal | grep "Connection.*timed out"
   ```

4. **Check tmux session:**
   ```bash
   # List tmux sessions
   tmux list-sessions
   
   # Check specific session
   tmux list-panes -t zeus-<session-id>
   ```

5. **Resolution:**
   - If tmux session missing: User must create new session (session terminated)
   - If WebSocket disconnected: Auto-reconnect should work, check network
   - If error in logs: Fix underlying issue (e.g., permission error, disk full)

---

### Workflow 2: Performance Degradation

**Steps:**

1. **Check system resources:**
   ```bash
   docker stats zeus-terminal
   df -h
   free -m
   ```

2. **Check connection count:**
   ```bash
   curl http://localhost:8096/api/metrics | grep 'zeus_websocket_connections'
   ```

3. **Check database size:**
   ```bash
   ls -lh data/zeus.db
   sqlite3 data/zeus.db "SELECT COUNT(*) FROM command_history"
   sqlite3 data/zeus.db "SELECT COUNT(*) FROM audit_log"
   ```

4. **Check slow queries:**
   ```bash
   # Enable query logging (add to logger config)
   # Then check for slow queries in logs
   grep 'query took' logs/combined.log | sort -t: -k4 -n | tail -20
   ```

5. **Resolution:**
   - High CPU: Check for runaway processes in tmux sessions
   - High memory: Restart container, check for memory leaks
   - Large database: Run cleanup: `npm run db:cleanup`
   - Too many connections: Increase max connections or add rate limiting

---

### Workflow 3: Authentication Issues

**Steps:**

1. **Check Authelia logs:**
   ```bash
   docker logs authelia | grep "user@example.com"
   ```

2. **Check nginx reverse proxy:**
   ```bash
   sudo tail -100 /var/log/nginx/zeus.herakles.dev.error.log
   sudo tail -100 /var/log/nginx/zeus.herakles.dev.access.log | grep "user@example.com"
   ```

3. **Check Zeus Terminal auth logs:**
   ```bash
   grep '"component":"auth"' logs/combined.log | jq .
   sqlite3 data/zeus.db "SELECT * FROM audit_log WHERE event LIKE 'auth.%' AND user_email = 'user@example.com' ORDER BY timestamp DESC LIMIT 10"
   ```

4. **Check for failed auth attempts:**
   ```bash
   sqlite3 data/zeus.db "SELECT * FROM audit_log WHERE event = 'auth.failure' ORDER BY timestamp DESC LIMIT 20"
   ```

5. **Resolution:**
   - If Authelia denies: Check Authelia configuration and user permissions
   - If nginx denies: Check nginx auth_request configuration
   - If Zeus denies: Check extractAuthFromUpgrade() logic in autheliaAuth.ts

---

## Log Query Recipes

### Recipe 1: All activity for a user in the last hour

```bash
# Audit log
sqlite3 data/zeus.db <<SQL
SELECT 
  datetime(timestamp) as time,
  event,
  session_id,
  details
FROM audit_log
WHERE user_email = 'user@example.com'
  AND timestamp > datetime('now', '-1 hour')
ORDER BY timestamp DESC;
SQL

# Winston logs
grep '"userEmail":"user@example.com"' logs/combined.log | \
  jq -r 'select(.timestamp > (now - 3600 | strftime("%Y-%m-%dT%H:%M:%S"))) | "\(.timestamp) \(.level) \(.message)"'
```

---

### Recipe 2: Find sessions with errors

```bash
# Sessions with errors in last 24 hours
sqlite3 data/zeus.db <<SQL
SELECT DISTINCT
  s.id,
  s.name,
  s.user_email,
  COUNT(a.id) as error_count
FROM sessions s
JOIN audit_log a ON a.session_id = s.id
WHERE a.level = 'error'
  AND a.timestamp > datetime('now', '-1 day')
GROUP BY s.id
ORDER BY error_count DESC;
SQL
```

---

### Recipe 3: Most active sessions

```bash
# By command count
sqlite3 data/zeus.db <<SQL
SELECT 
  s.id,
  s.name,
  s.user_email,
  COUNT(c.id) as command_count,
  datetime(MAX(c.timestamp)) as last_command
FROM sessions s
JOIN command_history c ON c.session_id = s.id
GROUP BY s.id
ORDER BY command_count DESC
LIMIT 10;
SQL
```

---

### Recipe 4: Trace tmux failures

```bash
# Tmux errors from Winston
grep '"component":"tmux"' logs/combined.log | grep '"level":"error"' | jq .

# Failed tmux commands
docker logs zeus-terminal | grep "tmux.*failed"

# Check tmux server status
tmux list-sessions
```

---

### Recipe 5: WebSocket rate limiting

```bash
# Rate limit events
sqlite3 data/zeus.db "SELECT * FROM audit_log WHERE event = 'rate_limit.exceeded' ORDER BY timestamp DESC LIMIT 20"

# User triggering rate limits
sqlite3 data/zeus.db <<SQL
SELECT 
  user_email,
  COUNT(*) as rate_limit_count,
  MAX(timestamp) as last_occurrence
FROM audit_log
WHERE event = 'rate_limit.exceeded'
GROUP BY user_email
ORDER BY rate_limit_count DESC;
SQL
```

---

## Performance Debugging

### Metrics Endpoint

```bash
# Get all Prometheus metrics
curl http://localhost:8096/api/metrics

# Specific metrics
curl http://localhost:8096/api/metrics | grep 'zeus_websocket_connections'
curl http://localhost:8096/api/metrics | grep 'zeus_session_count'
```

**Available Metrics:**
- `zeus_websocket_connections` - Active WebSocket connections
- `zeus_session_count` - Active sessions
- `zeus_session_state{state="active|dormant|terminated"}` - Sessions by state
- `http_request_duration_seconds` - HTTP request latency histogram
- `http_requests_total` - Total HTTP requests
- Node.js default metrics (CPU, memory, event loop lag)

---

### Identifying Memory Leaks

```bash
# Monitor memory over time
watch -n 5 'docker stats zeus-terminal --no-stream'

# Heap snapshot (requires node --inspect)
# Add to docker-compose: --inspect=0.0.0.0:9229
# Then use Chrome DevTools → Memory → Take Heap Snapshot
```

---

### Database Query Performance

```bash
# Check query plan
sqlite3 data/zeus.db "EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE user_email = 'user@example.com'"

# Check index usage
sqlite3 data/zeus.db ".schema sessions"

# Analyze database
sqlite3 data/zeus.db "ANALYZE; SELECT * FROM sqlite_stat1"
```

---

## WebSocket Debugging

### Browser DevTools

1. Open DevTools → Network tab
2. Filter: WS (WebSocket)
3. Click WebSocket connection
4. View frames (sent/received messages)

**What to look for:**
- Ping/Pong every 30s (heartbeat)
- Message types match protocol
- Large data frames (terminal output)
- Error messages with codes

---

### Server-Side WebSocket Logs

```bash
# All WebSocket operations
grep '"component":"websocket"' logs/combined.log | jq .

# Connection events
docker logs zeus-terminal | grep -E "(WebSocket connected|Connection.*timed out)"

# Message validation failures
grep 'Invalid message' logs/combined.log | jq .
```

---

### Message Rate Limiting

```bash
# Check rate limit configuration
grep 'rateLimitRequests\|rateLimitWindowMs' .env

# Current rate limit state (in-memory, check metrics)
curl http://localhost:8096/api/metrics | grep rate_limit
```

---

## Tmux Debugging

### Check Tmux Server Health

```bash
# List all Zeus sessions
tmux list-sessions | grep zeus

# Check panes for session
tmux list-panes -t zeus-<session-id> -a -F "#{session_name} #{window_index} #{pane_index} #{pane_pid} #{pane_width}x#{pane_height}"

# Attach to session manually (debug terminal output)
tmux attach -t zeus-<session-id>
```

---

### Capture Pane Content

```bash
# What Zeus Terminal uses for restore
tmux capture-pane -t zeus-<session-id>:0.0 -p -S - -E -

# Save to file
tmux capture-pane -t zeus-<session-id>:0.0 -p -S - -E - > /tmp/pane-content.txt
```

---

### Tmux Socket Issues

```bash
# Check socket directory
ls -la /tmp/zeus-tmux/

# Check socket permissions
stat /tmp/zeus-tmux/default

# Manually create session
tmux -L zeus-tmux new-session -d -s test-session
```

---

## Summary Checklist

**When debugging, always:**
1. ✅ Check user's email and session ID
2. ✅ Query audit log for timeline
3. ✅ Check Winston logs for operational details
4. ✅ Verify tmux session/panes exist
5. ✅ Check WebSocket connection status
6. ✅ Review recent errors in last hour
7. ✅ Check system resources (CPU/memory/disk)
8. ✅ Correlate timestamps across log sources
9. ✅ Test user flow manually if reproducible
10. ✅ Document findings for future reference

**Log Sources (in order of usefulness):**
1. **audit_log table** - Security events, user actions
2. **Winston logs** - Operational events, errors
3. **command_history table** - User commands
4. **Docker logs** - Container-level events
5. **Nginx logs** - HTTP/reverse proxy events
6. **Browser console** - Client-side errors

**Remember:** Logs are your source of truth. Always correlate across multiple sources before drawing conclusions.

---

**End of Debugging Guide**
