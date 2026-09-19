#!/usr/bin/env bash
#
# 03 — Feature toggles.
#
# Covers:
#   - extra_body.deepthink: true     → DeepThink (R1)
#   - extra_body.web_search: true    → Web Search
#   - both at once
#
# Important: toggles are PER-REQUEST. If a request omits
# extra_body.deepthink, the server explicitly disables DeepThink.
#
# Requires: curl, jq
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ---------------------------------------------------------------------
# 1. DeepThink only
# ---------------------------------------------------------------------

example_deepthink() {
    local api_key="$1"
    section "Example 1: DeepThink"

    local messages extra response
    messages=$(jq -n '[{role: "user", content: "Explain quantum entanglement in simple terms."}]')
    extra='{"deepthink": true}'

    response=$(send_chat "$api_key" "$messages" "" "$extra")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 2. Web Search only
# ---------------------------------------------------------------------

example_web_search() {
    local api_key="$1"
    section "Example 2: Web Search"

    local messages extra response
    messages=$(jq -n '[{role: "user", content: "What are the latest developments in AI?"}]')
    extra='{"web_search": true}'

    response=$(send_chat "$api_key" "$messages" "" "$extra")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 3. Both
# ---------------------------------------------------------------------

example_both() {
    local api_key="$1"
    section "Example 3: DeepThink + Web Search"

    local messages extra response
    messages=$(jq -n '[{role: "user", content: "Compare the latest AI regulation proposals in the EU and the US."}]')
    extra='{"deepthink": true, "web_search": true}'

    response=$(send_chat "$api_key" "$messages" "" "$extra")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 4. Reset — toggles do not persist
# ---------------------------------------------------------------------

example_reset() {
    local api_key="$1"
    section "Example 4: reset (no extra_body)"

    local messages response
    messages=$(jq -n '[{role: "user", content: "What is 2 + 2?"}]')

    # No 4th argument → no extra_body → both toggles reset to false.
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

main() {
    banner "03 — Feature toggles"
    local api_key
    api_key=$(load_or_register_key)

    example_deepthink "$api_key"
    example_web_search "$api_key"
    example_both "$api_key"
    example_reset "$api_key"

    banner "Done."
}

main "$@"