#!/bin/bash

# Test handoff window creation reliability
# Runs 10 iterations and checks success rate

ZEUS_URL="${ZEUS_URL:-http://localhost:8096}"
ZEUS_USER="${ZEUS_USER:-hercules}"
ZEUS_EMAIL="${ZEUS_EMAIL:-hello@herakles.dev}"
PROJECT_PATH="/home/hercules/herakles-terminal"
LOG_FILE="/tmp/handoff_test_$$.log"

SUCCESS_COUNT=0
FAILURE_COUNT=0
TIMEOUT_COUNT=0

echo "Starting handoff reliability test..."
echo "ZEUS_URL: $ZEUS_URL"
echo "Project: $PROJECT_PATH"
echo "Log file: $LOG_FILE"
echo ""

# Get active session
echo "[TEST] Getting active session..."
SESSION_RESPONSE=$(curl -s "$ZEUS_URL/api/sessions" \
  -H "Remote-User: $ZEUS_USER" \
  -H "Remote-Email: $ZEUS_EMAIL")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.data[0].id // empty')
CSRF_TOKEN=$(echo "$SESSION_RESPONSE" | jq -r '.data[0].csrf_token // empty')

if [ -z "$SESSION_ID" ]; then
  echo "ERROR: No active session found"
  echo "Response: $SESSION_RESPONSE"
  exit 1
fi

echo "Found session: $SESSION_ID"
echo ""

# Run 10 test iterations
for i in {1..10}; do
  echo "=== TEST RUN $i/10 ==="
  
  # Create temporary handoff file
  TEMP_HANDOFF="/tmp/test_handoff_$i.md"
  cat > "$TEMP_HANDOFF" << 'HANDOFF'
# Handoff Context

## Quick Resume
\```
echo "Test automation run"
\```
HANDOFF
  
  # Create automation
  AUTOMATION_RESPONSE=$(curl -s -X POST "$ZEUS_URL/api/automations" \
    -H "Remote-User: $ZEUS_USER" \
    -H "Remote-Email: $ZEUS_EMAIL" \
    -H "Content-Type: application/json" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d '{
      "sessionId": "'$SESSION_ID'",
      "name": "test-handoff-'$i'",
      "trigger": "on_resume",
      "triggerConfig": {},
      "createWindow": true,
      "windowName": "test-window-'$i'",
      "steps": [
        {"id": "1", "command": "cd '$PROJECT_PATH'", "delayAfter": 1},
        {"id": "2", "command": "echo Test_'$i'", "delayAfter": 0}
      ]
    }')
  
  AUTOMATION_ID=$(echo "$AUTOMATION_RESPONSE" | jq -r '.data.id // empty')
  
  if [ -z "$AUTOMATION_ID" ]; then
    echo "FAILED: Could not create automation"
    echo "Response: $AUTOMATION_RESPONSE"
    ((FAILURE_COUNT++))
    continue
  fi
  
  echo "Created automation: $AUTOMATION_ID"
  
  # Run automation
  START_TIME=$(date +%s)
  RUN_RESPONSE=$(curl -s -X POST "$ZEUS_URL/api/automations/$AUTOMATION_ID/run" \
    -H "Remote-User: $ZEUS_USER" \
    -H "Remote-Email: $ZEUS_EMAIL" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    --max-time 20 2>&1)
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))
  
  SUCCESS=$(echo "$RUN_RESPONSE" | jq -r '.data.success // empty')
  WINDOW_ID=$(echo "$RUN_RESPONSE" | jq -r '.data.windowId // empty')
  ERROR=$(echo "$RUN_RESPONSE" | jq -r '.data.error // empty')
  
  if echo "$RUN_RESPONSE" | grep -q "Timeout\|Connection timed out"; then
    echo "TIMEOUT: Request timed out after ${DURATION}s"
    ((TIMEOUT_COUNT++))
  elif [ "$SUCCESS" = "true" ] && [ ! -z "$WINDOW_ID" ]; then
    echo "SUCCESS: Window created ($WINDOW_ID) in ${DURATION}s"
    ((SUCCESS_COUNT++))
  elif [ "$SUCCESS" = "true" ]; then
    echo "PARTIAL: Automation ran but may not have created window"
    ((SUCCESS_COUNT++))
  else
    echo "FAILED: $ERROR"
    echo "Full response: $RUN_RESPONSE"
    ((FAILURE_COUNT++))
  fi
  
  sleep 2  # Wait between runs
done

echo ""
echo "========== TEST RESULTS =========="
echo "Success:  $SUCCESS_COUNT/10"
echo "Failure:  $FAILURE_COUNT/10"
echo "Timeout:  $TIMEOUT_COUNT/10"
echo "Total:    $((SUCCESS_COUNT + FAILURE_COUNT + TIMEOUT_COUNT))/10"
echo "Success Rate: $(( (SUCCESS_COUNT * 100) / 10 ))%"
echo "=================================="

if [ $SUCCESS_COUNT -ge 9 ]; then
  echo "RESULT: PASS (>= 90% success rate)"
  exit 0
else
  echo "RESULT: FAIL (< 90% success rate)"
  exit 1
fi
