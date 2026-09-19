#!/usr/bin/env bash
#
# 01 — Getting started.
#
# Covers:
#   - GET  /health
#   - POST /v1/register           (create a session)
#   - POST /v1/chat/completions   (single user message)
#
# The API key is saved to .examples-api-key and reused by all
# subsequent examples.
#
# Requires: curl, jq
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ---------------------------------------------------------------------
# 1. Health check
# ---------------------------------------------------------------------

check_health() {
    local response
    if ! response=$(curl -sS "$BASE_URL/health" 2>/dev/null); then
        echo "✗ Server unreachable at $BASE_URL" >&2
        echo "  Start it with: npm start" >&2
        exit 1
    fi

    local status
    status=$(echo "$response" | jq -r '.status // empty')

    if [[ -z "$status" ]]; then
        echo "✗ Health check returned unexpected response: $response" >&2
        exit 1
    fi

    echo "✓ Health: $status"
}

# ---------------------------------------------------------------------
# 2. Registration
# ---------------------------------------------------------------------

# Covered by load_or_register_key() from common.sh.
# If you need to force a new session, delete .examples-api-key and rerun.

# ---------------------------------------------------------------------
# 3. Basic chat
# ---------------------------------------------------------------------

basic_chat() {
    local api_key="$1"

    echo ""
    echo "→ Sending a single user message..."

    local messages
    messages=$(jq -n '[{role: "user", content: "Say '\''Hello, API!'\''"}]')

    local response
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

main() {
    banner "01 — Getting started"

    check_health
    local api_key
    api_key=$(load_or_register_key)
    basic_chat "$api_key"

    banner "Done."
}

main "$@"