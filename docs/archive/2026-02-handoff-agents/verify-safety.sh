#!/bin/bash

# Safety Safeguards Verification Script
# Verifies all safety mechanisms are properly implemented

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

check() {
  local description=$1
  local command=$2

  echo -ne "Checking: $description... "

  if eval "$command" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
    ((PASS_COUNT++))
  else
    echo -e "${RED}✗${NC}"
    ((FAIL_COUNT++))
  fi
}

warn() {
  local description=$1
  echo -e "${YELLOW}⚠ Warning: $description${NC}"
  ((WARN_COUNT++))
}

echo "================================================"
echo "Safety Safeguards Verification"
echo "================================================"
echo ""

# 1. Python Script Checks
echo "1. Python Script Rate Limiting"
echo "--------------------------------"
check "Python script exists" "test -f ~/.claude/hooks/spawn-claude-window.py"
check "Python script is executable" "test -x ~/.claude/hooks/spawn-claude-window.py"
check "Python syntax valid" "python3 -m py_compile ~/.claude/hooks/spawn-claude-window.py"
check "Rate limit constants defined" "grep -q 'MAX_CALLS_PER_MINUTE' ~/.claude/hooks/spawn-claude-window.py"
check "check_rate_limit function exists" "grep -q 'def check_rate_limit' ~/.claude/hooks/spawn-claude-window.py"
check "record_handoff_failure function exists" "grep -q 'def record_handoff_failure' ~/.claude/hooks/spawn-claude-window.py"
check "cleanup_stale_locks function exists" "grep -q 'def cleanup_stale_locks' ~/.claude/hooks/spawn-claude-window.py"
check "Rate limit file handling" "grep -q 'RATE_LIMIT_FILE' ~/.claude/hooks/spawn-claude-window.py"
check "Rapid-fire detection (10s check)" "grep -q 'now - recent_calls' ~/.claude/hooks/spawn-claude-window.py"
echo ""

# 2. TypeScript Compilation
echo "2. TypeScript Compilation"
echo "------------------------"
check "TypeScript compiles (ignoring unused warnings)" "npm run typecheck 2>&1 | grep -v TS6133 | ! grep -i 'error'"
echo ""

# 3. AutomationEngine Changes
echo "3. AutomationEngine Safety Features"
echo "-----------------------------------"
check "MAX_EXECUTION_TIME_MS defined" "grep -q 'MAX_EXECUTION_TIME_MS.*30' src/server/automation/AutomationEngine.ts"
check "MAX_CONCURRENT_PER_USER defined" "grep -q 'MAX_CONCURRENT_PER_USER.*10' src/server/automation/AutomationEngine.ts"
check "executionTimeouts Map exists" "grep -q 'executionTimeouts.*Map' src/server/automation/AutomationEngine.ts"
check "userConcurrencyCount Map exists" "grep -q 'userConcurrencyCount.*Map' src/server/automation/AutomationEngine.ts"
check "executeWithTimeout method exists" "grep -q 'async executeWithTimeout' src/server/automation/AutomationEngine.ts"
check "Concurrency check in executeAutomation" "grep -q 'CONCURRENCY_LIMIT_EXCEEDED' src/server/automation/AutomationEngine.ts"
check "Timeout cleanup in finally block" "grep -q 'executionTimeouts.delete' src/server/automation/AutomationEngine.ts"
echo ""

# 4. Rate Limiting Middleware
echo "4. Rate Limiting Middleware"
echo "----------------------------"
check "handoffLimiter function exists" "grep -q 'export function handoffLimiter' src/server/middleware/rateLimit.ts"
check "handoffLimiter limit set to 5" "grep -A 3 'function handoffLimiter' src/server/middleware/rateLimit.ts | grep -q 'limit: 5'"
check "handoffLimiter window is 60s" "grep -A 3 'function handoffLimiter' src/server/middleware/rateLimit.ts | grep -q '60.*1000'"
check "handoffLimiter lockout 5 minutes" "grep -A 3 'function handoffLimiter' src/server/middleware/rateLimit.ts | grep -q 'lockoutMinutes: 5'"
echo ""

# 5. Server Integration
echo "5. Server Integration"
echo "---------------------"
check "handoffLimiter imported in index.ts" "grep -q 'handoffLimiter' src/server/index.ts"
check "handoffLimiter applied to /api/automations/:id/run" "grep -q \"app.use('/api/automations/:id/run', handoffLimiter\" src/server/index.ts"
echo ""

# 6. Documentation
echo "6. Documentation"
echo "----------------"
check "SAFETY.md exists" "test -f docs/SAFETY.md"
check "SAFETY.md has rate limiting section" "grep -q 'Rate Limiting' docs/SAFETY.md"
check "SAFETY.md has timeout section" "grep -q 'Execution Timeouts' docs/SAFETY.md"
check "SAFETY.md has monitoring section" "grep -q 'Monitoring' docs/SAFETY.md"
check "SAFETY_IMPLEMENTATION.md exists" "test -f docs/SAFETY_IMPLEMENTATION.md"
check "Implementation doc has error codes" "grep -q 'Error Codes' docs/SAFETY_IMPLEMENTATION.md"
echo ""

# 7. Tests
echo "7. Test Coverage"
echo "----------------"
check "Safety tests file exists" "test -f src/server/__tests__/safety.test.ts"
check "Rate limiting tests" "grep -q 'describe.*Rate Limiting' src/server/__tests__/safety.test.ts"
check "Execution timeout tests" "grep -q 'describe.*Execution Timeouts' src/server/__tests__/safety.test.ts"
check "Concurrency enforcement test" "grep -q 'enforce.*concurrency' src/server/__tests__/safety.test.ts"
echo ""

# 8. Configuration Checks
echo "8. Configuration Verification"
echo "-----------------------------"
check "Hooks directory exists" "test -d ~/.claude/hooks"
check "Hooks directory is writable" "test -w ~/.claude/hooks"
echo ""

# Summary
echo "================================================"
echo "Verification Summary"
echo "================================================"
echo -e "Passed:   ${GREEN}$PASS_COUNT${NC}"
echo -e "Failed:   ${RED}$FAIL_COUNT${NC}"
echo -e "Warnings: ${YELLOW}$WARN_COUNT${NC}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}✓ All safety checks passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some checks failed. Please review above.${NC}"
  exit 1
fi
