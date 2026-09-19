#!/usr/bin/env bash
#
# Shared helpers for all cURL examples.
#
# Usage (at the top of every script):
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/common.sh"
#
# Requires: curl, jq

BASE_URL="${DEEPSEEK_BASE_URL:-http://localhost:3000}"
KEY_FILE="$(dirname "${BASH_SOURCE[0]}")/.examples-api-key"

# ---------------------------------------------------------------------
# Session / API key
# ---------------------------------------------------------------------

load_or_register_key() {
    if [[ -f "$KEY_FILE" ]]; then
        local key
        key="$(cat "$KEY_FILE")"
        if [[ -n "$key" ]]; then
            echo "✓ Loaded existing API key: ${key:0:24}..." >&2
            echo "$key"
            return
        fi
    fi

    echo "→ No saved key. Registering a new session..." >&2
    local email="${DEEPSEEK_EMAIL:-your@email.com}"
    local password="${DEEPSEEK_PASSWORD:-your_password}"

    local response
    response=$(curl -sS -X POST "$BASE_URL/v1/register" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$password\"}")

    local key
    key=$(echo "$response" | jq -r '.api_key')
    echo "$key" > "$KEY_FILE"
    echo "✓ New API key: ${key:0:24}... (saved to $(basename "$KEY_FILE"))" >&2
    echo "$key"
}

# ---------------------------------------------------------------------
# Chat request
# ---------------------------------------------------------------------

# Usage: send_chat "$API_KEY" '<messages-json>' [<tools-json>] [<extra_body-json>]
send_chat() {
    local api_key="$1"
    local messages_json="$2"
    local tools_json="${3:-}"
    local extra_json="${4:-}"

    # Build payload incrementally with jq to keep JSON valid.
    local payload
    payload=$(jq -n --argjson messages "$messages_json" '{messages: $messages}')

    if [[ -n "$tools_json" ]]; then
        payload=$(echo "$payload" | jq --argjson t "$tools_json" '. + {tools: $t}')
    fi
    if [[ -n "$extra_json" ]]; then
        payload=$(echo "$payload" | jq --argjson e "$extra_json" '. + {extra_body: $e}')
    fi

    local response
    response=$(curl -sS -X POST "$BASE_URL/v1/chat/completions" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "$payload")

    # Surface non-200 as an error.
    local err
    err=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$err" ]]; then
        echo "✗ API error: $err" >&2
        exit 1
    fi

    echo "$response"
}

# ---------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------

print_response() {
    local response="$1"

    # Tool call?
    local tool_count
    tool_count=$(echo "$response" | jq '.choices[0].message.tool_calls | length // 0')

    if [[ "$tool_count" -gt 0 ]]; then
        echo "✓ Tool call(s) detected:"
        echo "$response" | jq -r '
            .choices[0].message.tool_calls[] |
            "   \(.function.name)(\(.function.arguments))"
        '
    else
        local content
        content=$(echo "$response" | jq -r '.choices[0].message.content')
        echo "✓ $content"
    fi

    print_context_status "$response"
}

print_context_status() {
    local response="$1"
    local status
    status=$(echo "$response" | jq '.context_status // empty')
    if [[ -z "$status" ]]; then
        return
    fi

    local used limit pct warning rec
    used=$(echo "$response" | jq -r '.context_status.chars_used')
    limit=$(echo "$response" | jq -r '.context_status.chars_limit')
    pct=$(echo "$response" | jq -r '.context_status.percent_used')
    warning=$(echo "$response" | jq -r '.context_status.warning // empty')
    rec=$(echo "$response" | jq -r '.context_status.recommendation // empty')

    echo "   context: $used / $limit chars ($pct%)"
    if [[ -n "$warning" ]]; then
        echo "   ⚠ warning: $warning → $rec"
    fi

    local detected readable
    detected=$(echo "$response" | jq -r '.context_status.deepseek_length_limit.detected // false')
    if [[ "$detected" == "true" ]]; then
        readable=$(echo "$response" | jq -r '.context_status.deepseek_length_limit.readable_percent')
        echo "   🚫 DeepSeek read only $readable%"
    fi
}

# ---------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------

banner() {
    echo "============================================================"
    echo "$1"
    echo "============================================================"
}

section() {
    echo ""
    echo "------------------------------------------------------------"
    echo "$1"
    echo "------------------------------------------------------------"
}