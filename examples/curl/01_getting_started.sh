#!/usr/bin/env bash
#
# 01 — Getting started.
#
# Register a session, then send one message.
#
#     export API_KEY=deepseek_...    (after step 2)
#     bash 01_getting_started.sh
#
# Every command below is a complete, copy-paste-ready curl call.
# For pretty JSON output, append:  | jq

BASE_URL=http://localhost:3000

# ─────────────────────────────────────────────────────────────────────
# Step 1. Health check
# ─────────────────────────────────────────────────────────────────────
#
# Confirm the server is up.

curl $BASE_URL/health
# → {"status":"ok","timestamp":"2026-09-20T..."}

# ─────────────────────────────────────────────────────────────────────
# Step 2. Register a session
# ─────────────────────────────────────────────────────────────────────
#
# A "session" is one API key bound to one active browser chat. You
# only need to do this once — save the key and reuse it.
#
# Response:
#   {
#     "api_key": "deepseek_1789662945767_s8un7bvjft",
#     "message": "Store this API key securely."
#   }

curl -X POST $BASE_URL/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'

# Copy the api_key value, then in your shell:
#     export API_KEY=deepseek_1789662945767_s8un7bvjft

# ─────────────────────────────────────────────────────────────────────
# Step 3. Send a single user message
# ─────────────────────────────────────────────────────────────────────
#
# The simplest possible request: one user message, no history, no
# system prompt.
#
# A single user message without system/history is sent to DeepSeek
# as-is — the server does NOT add "User:" prefixes in this case. This
# keeps simple requests looking like a normal chat. See algorithm B1.
#
# Response shape:
#   {
#     "choices": [{
#       "index": 0,
#       "message": {"role": "assistant", "content": "Hello, API!"},
#       "finish_reason": "stop"
#     }],
#     "usage": {"prompt_tokens": 5, "completion_tokens": 4, ...},
#     "context_status": {
#       "chars_used": 28,
#       "chars_limit": 2400000,
#       "percent_used": 0.0,
#       "language_mix": {"latin": 1.0, ...},
#       "deepseek_length_limit": {"detected": false, "readable_percent": null},
#       "warning": null,
#       "recommendation": null
#     }
#   }

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say Hello, API!"}]}'

# To extract only the assistant's reply:
#
#   curl -X POST ... | jq -r '.choices[0].message.content'
#   → Hello, API!
#
# To see only the context counter:
#
#   curl -X POST ... | jq '.context_status'
#   → {"chars_used": 28, "chars_limit": 2400000, "percent_used": 0, ...}

# ─────────────────────────────────────────────────────────────────────
# What next
# ─────────────────────────────────────────────────────────────────────
#
# Every successful response carries a context_status block. In long
# sessions this becomes the client's early-warning system: the server
# transitions to a new chat at 70% and 90% of the context limit, and
# the client must be prepared for that.
#
# See:
#   02_conversation.sh  — system prompts, multi-turn, tool calling
#   03_features.sh      — DeepThink, Web Search
#   04_files.sh         — file uploads
#   05_session.sh       — context monitoring and error handling
#
# Full protocol: docs/guides/session-management.md