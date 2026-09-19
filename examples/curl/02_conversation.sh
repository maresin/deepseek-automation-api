#!/usr/bin/env bash
#
# 02 — Conversation patterns.
#
# Covers:
#   - system + user
#   - multi-turn
#   - tool calling
#
# Requires: curl, jq
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ---------------------------------------------------------------------
# 1. system + user
# ---------------------------------------------------------------------

example_system_user() {
    local api_key="$1"
    section "Example 1: system + user"

    local messages
    messages=$(jq -n '[
        {role: "system", content: "You are an assistant that speaks like a pirate."},
        {role: "user", content: "Tell me a short joke."}
    ]')

    local response
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 2. Multi-turn
# ---------------------------------------------------------------------

example_multi_turn() {
    local api_key="$1"
    section "Example 2: multi-turn"

    local messages
    messages=$(jq -n '[
        {role: "user", content: "What is the capital of France?"},
        {role: "assistant", content: "The capital of France is Paris."},
        {role: "user", content: "What is the most famous museum there?"}
    ]')

    local response
    response=$(send_chat "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 3. Tool calling
# ---------------------------------------------------------------------

example_tool_calling() {
    local api_key="$1"
    section "Example 3: tool calling"

    local messages
    messages=$(jq -n '[{role: "user", content: "What is the weather in Moscow?"}]')

    local tools
    tools=$(jq -n '[{
        type: "function",
        function: {
            name: "get_weather",
            description: "Get current weather for a city",
            parameters: {
                type: "object",
                properties: {
                    location: {type: "string", description: "City name"},
                    unit: {type: "string", enum: ["celsius", "fahrenheit"]}
                },
                required: ["location"]
            }
        }
    }]')

    local response
    response=$(send_chat "$api_key" "$messages" "$tools")
    print_response "$response"
}

# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

main() {
    banner "02 — Conversation patterns"
    local api_key
    api_key=$(load_or_register_key)
    example_system_user "$api_key"
    example_multi_turn "$api_key"
    example_tool_calling "$api_key"
    banner "Done."
}

main "$@"