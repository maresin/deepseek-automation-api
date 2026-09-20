#!/usr/bin/env bash
#
# 05 — Session management and error handling.
#
# The other examples assume the session never overflows and the network
# is reliable. Real usage is different.
#
# Two independent limits
# ──────────────────────
#   context_status.chars_limit           — our estimate:
#                                           1_000_000 tokens × language_coefficient
#   context_status.deepseek_length_      — the real limit DeepSeek actually read
#     limit.readable_percent               (appears only when the banner fires)
#
# The estimate is intentionally the EARLIER of the two. Transitions are
# triggered by the estimate; the real banner is an emergency path.
#
# Graceful degradation
# ────────────────────
# When a chat reaches the limit, the server transitions to a NEW chat.
# Snapshot and RAG transfer only a fraction of the old context. Even with
# both enabled, the model treats the transferred content as a DOCUMENT,
# not as its own memory. Quality drops after every transition.
#
# Client responsibilities
# ───────────────────────
#   1. Inspect context_status on EVERY successful response.
#   2. Log warning changes: null → context_above_70 → context_near_limit.
#   3. On 409 context_exhausted: call /v1/chat/new, retry.
#   4. On 503 server_busy: do NOT retry — the server is shutting down.
#   5. On 401 invalid_key: re-register via /v1/register.
#   6. On 504 timeout: retry with exponential backoff.
#   7. Keep critical facts in the system message — not in messages[].
#
#     export API_KEY=deepseek_...
#     bash 05_session.sh
#
# Full protocol: docs/guides/session-management.md

BASE_URL=http://localhost:3000

# ─────────────────────────────────────────────────────────────────────
# 1. Context status — cheap health check
# ─────────────────────────────────────────────────────────────────────
#
# Response:
#   {"totalChars":140,"maxChars":2400000,"percent":0,
#    "snapshot70Done":false,"snapshot90Done":false}

curl $BASE_URL/v1/context/status \
  -H "Authorization: Bearer $API_KEY"

# ─────────────────────────────────────────────────────────────────────
# 2. Fresh chat — reset context, clear RAG index
# ─────────────────────────────────────────────────────────────────────
#
# Use this after a 409 context_exhausted, or to start a new topic.
# The RAG index for the session is cleared: the new chat should not
# be polluted by the old one.
#
# Response: {"success":true,"restore":false}

curl -X POST $BASE_URL/v1/chat/new \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"restore": false}'

# ─────────────────────────────────────────────────────────────────────
# 3. Restore the last chat — RAG index preserved
# ─────────────────────────────────────────────────────────────────────
#
# Use this to return to the previous chat without losing the index.
# Response: {"success":true,"restore":true}
#
# If no chat is found, the response is 409 with
#   {"error": {"type": "restore_failed", "reason": "chat_not_found",
#              "message": "...", "state_cleared": true}}

curl -X POST $BASE_URL/v1/chat/new \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"restore": true}'

# ─────────────────────────────────────────────────────────────────────
# 4. Temporary chat — main session is not touched
# ─────────────────────────────────────────────────────────────────────
#
# The request runs in a temporary chat that is discarded afterward.
# The main chat's context counter, snapshot flags, and RAG index are
# unaffected.
#
# Response:
#   {"success":true,"answer":"4","inserted":false}
#
# Optional flags (as additional -F fields):
#   -F "return_only=true"        → {"answer":"4"}
#   -F "insert_to_context=true"  → answer appended to main chat

curl -X POST $BASE_URL/v1/chat/single \
  -H "Authorization: Bearer $API_KEY" \
  -F 'messages=[{"role":"user","content":"Answer briefly: what is 2+2?"}]'

# ─────────────────────────────────────────────────────────────────────
# 5. Error handling — what each response code means
# ─────────────────────────────────────────────────────────────────────
#
# 200  success
# 400  validation error (bad messages, tools, extra_body)
# 401  invalid API key
# 409  context_exhausted — see below
# 503  server_busy       — server shuts down, wait for restart
# 504  timeout
#
# When you get 409, the body looks like:
#
#   {
#     "error": {
#       "type": "context_exhausted",
#       "message": "DeepSeek context limit reached",
#       "chat_id": "...",
#       "chars_used": 2345678,
#       "chars_limit": 2400000,
#       "deepseek_readable_percent": 75,
#       "partial_response": "...",
#       "banner_text": "Length limit reached...",
#       "rag_enabled": true,
#       "recovery": "Call POST /v1/chat/new to start a new session..."
#     }
#   }
#
# Recommended client flow:
#
#   1. Check context_status on every successful response.
#   2. When warning = "context_above_70", prepare for a transition.
#   3. On 409: call /v1/chat/new {restore: false}, then retry.
#   4. On 503: wait for the server to restart; do not retry.
#   5. On 401: re-register via /v1/register.
#   6. On 504: retry with exponential backoff.
#
# Full discussion: docs/guides/session-management.md
#
# Note on retry logic:
#
#   This file shows the raw requests. A bash script cannot express the
#   retry loop cleanly — for that, see:
#     examples/python/05_session.py
#     examples/javascript/05_session.js
#
#   Those files contain the full client protocol with backoff and
#   error handling.