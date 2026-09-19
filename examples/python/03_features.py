#!/usr/bin/env python3
"""
03 — Feature toggles.

Covers:
  - extra_body.deepthink: true     → DeepThink (R1)
  - extra_body.web_search: true    → Web Search
  - both at once

Important: toggles are PER-REQUEST.
If a request omits extra_body.deepthink, the server explicitly disables
DeepThink before sending — see server-modules/routes/chat.js. This
prevents state from leaking between calls, but also means you must pass
the flags every time you want them on.

Timing note: DeepThink takes significantly longer than a normal request
(60–120s vs 15–30s). The timeout in common.send_chat is 180s by default.

Context note: DeepThink generates internal reasoning that is not shown
in the final answer but still consumes context. The server multiplies
the response length by DEEPSEEK_DEEPTHINK_MULTIPLIER (default 2.5) when
updating context_status.chars_used. See algorithm C7.
"""

from common import (
    banner, section,
    load_or_register_key, send_chat, print_response,
)


# ---------------------------------------------------------------------
# 1. DeepThink only
# ---------------------------------------------------------------------

def example_deepthink(api_key: str) -> None:
    """
    Enable DeepThink for this single request. The server prepends a
    SwitchDeepThinkTask that clicks the toggle, then sends the message.

    Toggle state does NOT persist. The next request without deepthink
    will explicitly turn it off.
    """
    section("Example 1: DeepThink")

    messages = [{
        "role": "user",
        "content": "Explain quantum entanglement in simple terms.",
    }]
    data = send_chat(api_key, messages, extra_body={"deepthink": True})
    print_response(data)


# ---------------------------------------------------------------------
# 2. Web Search only
# ---------------------------------------------------------------------

def example_web_search(api_key: str) -> None:
    """
    Enable Web Search for this single request. The server prepends a
    SwitchWebSearchTask that clicks the toggle.

    Web Search is best for recent-events questions. Without it the model
    answers from its training cutoff; with it, it searches first.
    """
    section("Example 2: Web Search")

    messages = [{
        "role": "user",
        "content": "What are the latest developments in AI?",
    }]
    data = send_chat(api_key, messages, extra_body={"web_search": True})
    print_response(data)


# ---------------------------------------------------------------------
# 3. Both
# ---------------------------------------------------------------------

def example_both(api_key: str) -> None:
    """
    Both toggles on. DeepThink + Web Search: the model searches, then
    reasons about the results before answering. Slowest mode, most
    thorough.
    """
    section("Example 3: DeepThink + Web Search")

    messages = [{
        "role": "user",
        "content": "Compare the latest AI regulation proposals in the EU and the US.",
    }]
    data = send_chat(api_key, messages, extra_body={
        "deepthink": True,
        "web_search": True,
    })
    print_response(data)


# ---------------------------------------------------------------------
# 4. Demonstrating that toggles do NOT persist
# ---------------------------------------------------------------------

def example_reset(api_key: str) -> None:
    """
    Send a request WITHOUT extra_body. Even though the previous request
    had both toggles on, this one runs in plain mode.

    This is intentional: the server explicitly resets toggles on every
    request. Clients cannot rely on toggle state persisting between calls.
    """
    section("Example 4: reset (no extra_body)")

    messages = [{
        "role": "user",
        "content": "What is 2 + 2?",
    }]
    data = send_chat(api_key, messages)
    print_response(data)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> None:
    banner("03 — Feature toggles")
    api_key = load_or_register_key()

    example_deepthink(api_key)
    example_web_search(api_key)
    example_both(api_key)
    example_reset(api_key)

    banner("Done.")


if __name__ == "__main__":
    main()