#!/usr/bin/env bash
#
# 05 — Session management and error handling.
#
# Covers:
#   - /v1/chat/new {restore: true/false}
#   - /v1/context/status
#   - /v1/chat/single
#   - Interpreting 409 / 503 / 401 / 504
#
# cURL cannot express a real retry loop with backoff cleanly. This
# script demonstrates each endpoint and prints what a production client
# should do with each response code. For the full retry logic, see
# 05_session.py or 05_session.js.
#
# Requires: curl, jq
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ---------------------------------------------------------------------
# /v1/chat/new
# ---------------------------------------------------------------------

chat_new() {
    local api_key="$1"
    local restore="$2"    # "true" or "false"

    local response
    response=$(curl -sS -X POST "$BASE_URL/v1/chat/new" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "{\"restore\": $restore}")

    local status
    status=$(echo "$response" | jq -r '.error.type // empty')

    if [[ "$status" == "restore_failed" ]]; then
        local reason
        reason=$(echo "$response" | jq -r '.error.reason')
        echo "  ⚠ Restore failed: $reason" >&2
        echo "    $(echo "$response" | jq -r '.error.message')" >&2
        # Fall back to fresh
        chat_new "$api_key" "false"
        return
    fi

    if [[ "$restore" == "true" ]]; then
        echo "  → New chat (restore)."
    else
        echo "  → New chat (fresh)."
    fi
}

# ---------------------------------------------------------------------
# /v1/context/status
# ---------------------------------------------------------------------

context_status() {
    local api_key="$1"
    local response
    response=$(curl -sS "$BASE_URL/v1/context/status" \
        -H "Authorization: Bearer $api_key")

    local used limit pct
    used=$(echo "$response" | jq -r '.totalChars')
    limit=$(echo "$response" | jq -r '.maxChars')
    pct=$(echo "$response" | jq -r '.percent')
    echo "  context: $used / $limit chars ($pct%)"
}

# ---------------------------------------------------------------------
# A single chat request with code inspection (no retry)
# ---------------------------------------------------------------------

inspect_response() {
    local response="$1"
    local http_code="$2"

    case "$http_code" in
        200)
            print_response "$response"
            ;;
        400)
            echo "✗ Validation error: $(echo "$response" | jq -r '.error')" >&2
            echo "  → Fix the request. Do NOT retry."
            ;;
        401)
            echo "✗ Invalid API key." >&2
            echo "  → Re-register via POST /v1/register."
            ;;
        409)
            echo "⚠ Context exhausted:" >&2
            echo "$response" | jq -r '
                "  chars_used: \(.error.chars_used)",
                "  chars_limit: \(.error.chars_limit)",
                "  deepseek_readable_percent: \(.error.deepseek_readable_percent)",
                "  rag_enabled: \(.error.rag_enabled)",
                "  recovery: \(.error.recovery)"
            ' >&2
            echo "  → Call /v1/chat/new {restore: false}, then retry."
            ;;
        503)
            echo "🚫 DeepSeek server busy." >&2
            echo "  → Server will shut down in ~500 ms. Wait for restart."
            ;;
        504)
            echo "⏱ Timeout." >&2
            echo "  → Retry with exponential backoff (1s, 2s, 4s)."
            ;;
        *)
            echo "✗ HTTP $http_code: $response" >&2
            ;;
    esac
}

# ---------------------------------------------------------------------
# Example 1: monitor context_status
# ---------------------------------------------------------------------

example_monitor() {
    local api_key="$1"
    section "Example 1: monitor context_status"

    echo "  before:"
    context_status "$api_key"

    local messages
    messages=$(jq -n '[{role: "user", content: "Say one word: OK."}]')

    local response http_code
    http_code=$(curl -sS -o /tmp/ds_resp.json -w "%{http_code}" \
        -X POST "$BASE_URL/v1/chat/completions" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --argjson m "$messages" '{messages: $m}')")
    response=$(cat /tmp/ds_resp.json)
    rm -f /tmp/ds_resp.json

    inspect_response "$response" "$http_code"

    echo "  after:"
    context_status "$api_key"
}

# ---------------------------------------------------------------------
# Example 2: recover after context exhaustion
# ---------------------------------------------------------------------

example_recover_409() {
    local api_key="$1"
    section "Example 2: recover after context exhaustion"

    echo "  Simulating: a request just returned 409."
    echo "  Recovery path: /v1/chat/new {restore: false}, then retry."
    chat_new "$api_key" "false"

    local messages
    messages=$(jq -n '[{role: "user", content: "We started over. Acknowledge."}]')

    local response
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# Example 3: restore vs fresh
# ---------------------------------------------------------------------

example_restore_vs_fresh() {
    local api_key="$1"
    section "Example 3: restore vs fresh"

    echo "  → fresh chat"
    chat_new "$api_key" "false"

    local messages response
    messages=$(jq -n '[{role: "user", content: "Say: fresh."}]')
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"

    echo ""
    echo "  → restore last chat"
    chat_new "$api_key" "true"

    messages=$(jq -n '[{role: "user", content: "Say: restored."}]')
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# Example 4: degradation — system message survives transitions
# ---------------------------------------------------------------------

example_degradation() {
    local api_key="$1"
    section "Example 4: degradation and the system message"

    echo "  Critical facts go in the system message, not in history."
    echo "  System messages are resent every request and survive any"
    echo "  transition. See docs/guides/session-management.md."

    chat_new "$api_key" "false"

    local system="Context that must survive any transition:
  Project: DeepSeek Automation API.
  Maintainer: Alice.
  Deadline: 2026-10-01.
Refer to these facts in every answer."

    local messages
    messages=$(jq -n --arg s "$system" '[
        {role: "system", content: $s},
        {role: "user", content: "Who is the maintainer?"}
    ]')

    local response
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"

    # Check if the answer mentions Alice.
    local content
    content=$(echo "$response" | jq -r '.choices[0].message.content')
    if [[ "$content" == *"Alice"* ]]; then
        echo "  ✓ Answer includes 'Alice'."
    else
        echo "  ✗ Answer does NOT include 'Alice'."
    fi
}

# ---------------------------------------------------------------------
# Example 5: temporary chat
# ---------------------------------------------------------------------

example_single() {
    local api_key="$1"
    section "Example 5: temporary chat (/v1/chat/single)"

    local messages_json='[{"role":"user","content":"Answer briefly: what is 2+2?"}]'

    local response
    response=$(curl -sS -X POST "$BASE_URL/v1/chat/single" \
        -H "Authorization: Bearer $api_key" \
        -F "messages=$messages_json")

    local answer
    answer=$(echo "$response" | jq -r '.answer // empty')

    if [[ -z "$answer" ]]; then
        echo "✗ HTTP error: $response" >&2
        return
    fi

    echo "✓ ${answer:0:120}"
    echo "  inserted into main context: $(echo "$response" | jq -r '.inserted')"
}

# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

main() {
    banner "05 — Session management and error handling"
    local api_key
    api_key=$(load_or_register_key)

    example_monitor "$api_key"
    example_recover_409 "$api_key"
    example_restore_vs_fresh "$api_key"
    example_degradation "$api_key"
    example_single "$api_key"

    banner "Done."
}

main "$@"