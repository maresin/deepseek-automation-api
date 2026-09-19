"""
Shared helpers for all Python examples.

Usage:
    from common import (
        BASE_URL, load_or_register_key,
        send_chat, print_response, print_context_status,
    )
"""

import json
import os
import sys
from pathlib import Path

import requests

BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "http://localhost:3000")
KEY_FILE = Path(__file__).parent / ".examples-api-key"


# ---------------------------------------------------------------------
# Session / API key
# ---------------------------------------------------------------------

def load_or_register_key() -> str:
    """Return an existing API key from .examples-api-key, or register a new one."""
    if KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
        if key:
            print(f"✓ Loaded existing API key: {key[:24]}...")
            return key

    print("→ No saved key. Registering a new session...")
    email = os.environ.get("DEEPSEEK_EMAIL", "your@email.com")
    password = os.environ.get("DEEPSEEK_PASSWORD", "your_password")

    r = requests.post(
        f"{BASE_URL}/v1/register",
        json={"email": email, "password": password},
        timeout=180,
    )
    r.raise_for_status()
    key = r.json()["api_key"]
    KEY_FILE.write_text(key)
    print(f"✓ New API key: {key[:24]}...  (saved to {KEY_FILE.name})")
    return key


# ---------------------------------------------------------------------
# Chat request
# ---------------------------------------------------------------------

def send_chat(
    api_key: str,
    messages: list,
    tools: list | None = None,
    extra_body: dict | None = None,
    timeout: int = 180,
) -> dict:
    """
    POST /v1/chat/completions with the given messages.

    Exits on non-200. Production clients should handle 409 / 503 / 401
    explicitly — see 05_session.py.
    """
    payload: dict = {"messages": messages}
    if tools is not None:
        payload["tools"] = tools
    if extra_body is not None:
        payload["extra_body"] = extra_body

    r = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )

    if r.status_code != 200:
        print(f"✗ HTTP {r.status_code}: {r.text}", file=sys.stderr)
        sys.exit(1)

    return r.json()


# ---------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------

def print_response(data: dict) -> None:
    """Print either the assistant message or the tool calls."""
    message = data["choices"][0]["message"]

    if message.get("tool_calls"):
        print("✓ Tool call(s) detected:")
        for tc in message["tool_calls"]:
            fn = tc["function"]
            print(f"   {fn['name']}({fn['arguments']})")
    else:
        print(f"✓ {message['content']}")

    print_context_status(data)


def print_context_status(data: dict) -> None:
    """Print the context_status block from a chat response."""
    status = data.get("context_status")
    if not status:
        return
    used = status["chars_used"]
    limit = status["chars_limit"]
    pct = status["percent_used"]
    print(f"   context: {used:,} / {limit:,} chars ({pct}%)")
    if status.get("warning"):
        print(f"   ⚠ warning: {status['warning']} → {status['recommendation']}")
    dll = status.get("deepseek_length_limit", {})
    if dll.get("detected"):
        print(f"   🚫 DeepSeek read only {dll.get('readable_percent')}%")


# ---------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------

def banner(title: str) -> None:
    """Print a section banner."""
    print("=" * 60)
    print(title)
    print("=" * 60)


def section(title: str) -> None:
    """Print a sub-section header."""
    print("\n" + "-" * 60)
    print(title)
    print("-" * 60)