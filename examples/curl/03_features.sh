#!/usr/bin/env bash
#
# 03 — Feature toggles.
#
#   extra_body.deepthink   → DeepThink (R1)
#   extra_body.web_search  → Web Search
#
#     export API_KEY=deepseek_...
#     bash 03_features.sh
#
# Toggles are PER-REQUEST. If a request omits deepthink, the server
# explicitly disables it before sending — state does not leak between
# calls. Pass the flags every time you want them on.
#
# Timing note: DeepThink takes significantly longer (60–120s vs 15–30s).
#
# Context note: DeepThink generates internal reasoning that is not shown
# in the final answer but still consumes context. The server multiplies
# the response length by DEEPSEEK_DEEPTHINK_MULTIPLIER (default 2.5)
# when updating context_status.chars_used. See algorithm C7.

BASE_URL=http://localhost:3000

# ─────────────────────────────────────────────────────────────────────
# 1. DeepThink (R1) only
# ─────────────────────────────────────────────────────────────────────
#
# Enables DeepThink for this single request. The server clicks the
# toggle before sending, then sends the message.
#
# The toggle does NOT persist. The next request without deepthink
# will explicitly turn it off.
#
# Note the longer curl timeout (--max-time 300) — DeepThink can take
# up to ~2 minutes.

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d '{
    "messages": [{"role":"user","content":"Explain quantum entanglement in simple terms."}],
    "extra_body": {"deepthink": true}
  }'

# ─────────────────────────────────────────────────────────────────────
# 2. Web Search only
# ─────────────────────────────────────────────────────────────────────
#
# Enables Web Search for this single request. Best for recent-events
# questions: without it the model answers from its training cutoff;
# with it, it searches first.

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"What are the latest developments in AI?"}],
    "extra_body": {"web_search": true}
  }'

# ─────────────────────────────────────────────────────────────────────
# 3. Both at once
# ─────────────────────────────────────────────────────────────────────
#
# DeepThink + Web Search: the model searches, then reasons about the
# results before answering. Slowest mode, most thorough.

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d '{
    "messages": [{"role":"user","content":"Compare the latest AI regulation proposals in the EU and the US."}],
    "extra_body": {"deepthink": true, "web_search": true}
  }'

# ─────────────────────────────────────────────────────────────────────
# 4. Reset — omitting extra_body turns both toggles off
# ─────────────────────────────────────────────────────────────────────
#
# Even though the previous request had both toggles on, this one runs
# in plain mode. The server explicitly resets toggles on every request.
# Clients cannot rely on toggle state persisting between calls.

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is 2 + 2?"}]}'