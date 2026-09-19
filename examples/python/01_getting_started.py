#!/usr/bin/env python3
"""
01 — Getting started.

Covers:
  - GET  /health
  - POST /v1/register           (create a session, via common helper)
  - POST /v1/chat/completions   (single user message)

The API key is saved to .examples-api-key in this directory and reused
by all subsequent examples.

This is the simplest example. It assumes the session never overflows
and the network is reliable. Real usage is different — see 05_session.py
for the full client-side protocol (409 / 503 / 401 / 504).
"""

import sys
import requests

from common import (
    BASE_URL, banner,
    load_or_register_key, send_chat, print_response,
)


# ---------------------------------------------------------------------
# 1. Health check
# ---------------------------------------------------------------------

def check_health() -> None:
    """Sanity check: is the server up?"""
    r = requests.get(f"{BASE_URL}/health", timeout=10)
    r.raise_for_status()
    print(f"✓ Health: {r.json()['status']}")


# ---------------------------------------------------------------------
# 2. Registration
# ---------------------------------------------------------------------

# Covered by load_or_register_key() from common.py.
# If you need to force a new session, delete .examples-api-key and rerun.


# ---------------------------------------------------------------------
# 3. Basic chat — single user message
# ---------------------------------------------------------------------

def basic_chat(api_key: str) -> None:
    """
    Simplest possible request: no system prompt, no history.

    buildPrompt sees exactly one user message without prefixes →
    sends the content as-is (no "User:" prefix). See algorithm B1.
    """
    print("\n→ Sending a single user message...")

    messages = [{"role": "user", "content": "Say 'Hello, API!'"}]
    data = send_chat(api_key, messages)
    print_response(data)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> None:
    banner("01 — Getting started")

    try:
        check_health()
    except requests.RequestException as e:
        print(f"✗ Server unreachable: {e}", file=sys.stderr)
        print("  Start it with: npm start", file=sys.stderr)
        sys.exit(1)

    api_key = load_or_register_key()
    basic_chat(api_key)

    banner("Done.")


if __name__ == "__main__":
    main()