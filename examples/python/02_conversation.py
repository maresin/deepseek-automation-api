#!/usr/bin/env python3
"""
02 — Conversation patterns.

Covers:
  - system + user (buildPrompt adds role prefixes)
  - multi-turn with assistant history
  - tool calling (function calling)

The server translates the OpenAI messages array into a single text prompt.
Role prefixes ("System:", "User:", "Assistant:") are added when there is
a system message OR more than one message — see algorithm B1.
"""

from common import (
    banner, section,
    load_or_register_key, send_chat, print_response,
)


# ---------------------------------------------------------------------
# 1. system + user
# ---------------------------------------------------------------------

def example_system_user(api_key: str) -> None:
    """
    buildPrompt sees a system message → adds "System:" and "User:"
    prefixes. The model receives a single prompt:

        System: You are an assistant that speaks like a pirate.
        User: Tell me a short joke.
    """
    section("Example 1: system + user")

    messages = [
        {"role": "system", "content": "You are an assistant that speaks like a pirate."},
        {"role": "user", "content": "Tell me a short joke."},
    ]
    data = send_chat(api_key, messages)
    print_response(data)


# ---------------------------------------------------------------------
# 2. Multi-turn conversation
# ---------------------------------------------------------------------

def example_multi_turn(api_key: str) -> None:
    """
    Full history sent in one request. buildPrompt sees multiple messages
    → adds prefixes to each:

        User: What is the capital of France?
        Assistant: The capital of France is Paris.
        User: What is the most famous museum there?

    The model sees the assistant's prior answer as part of the prompt,
    so it can follow the thread.
    """
    section("Example 2: multi-turn")

    messages = [
        {"role": "user", "content": "What is the capital of France?"},
        {"role": "assistant", "content": "The capital of France is Paris."},
        {"role": "user", "content": "What is the most famous museum there?"},
    ]
    data = send_chat(api_key, messages)
    print_response(data)


# ---------------------------------------------------------------------
# 3. Tool calling (function calling)
# ---------------------------------------------------------------------

def example_tool_calling(api_key: str) -> None:
    """
    Tools are described in JSON. buildPrompt prepends a toolsBlock with
    instructions to answer in JSON. When the model decides to call a tool,
    it returns:

        {"tool_calls": [{"name": "get_weather", "arguments": {...}}]}

    The server parses this and returns the OpenAI-shaped response with
    `message.tool_calls` and `finish_reason: "tool_calls"`.

    The server does NOT execute the tool. It is the client's job.
    """
    section("Example 3: tool calling")

    tools = [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["location"],
            },
        },
    }]

    messages = [
        {"role": "user", "content": "What is the weather in Moscow?"},
    ]
    data = send_chat(api_key, messages, tools=tools)
    print_response(data)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> None:
    banner("02 — Conversation patterns")
    api_key = load_or_register_key()
    example_system_user(api_key)
    example_multi_turn(api_key)
    example_tool_calling(api_key)
    banner("Done.")


if __name__ == "__main__":
    main()