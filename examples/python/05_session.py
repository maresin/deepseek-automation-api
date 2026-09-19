#!/usr/bin/env python3
"""
05 — Session management and error handling.

The most important example. The first four are optimistic: they assume
the session never overflows and the network is reliable. Real usage is
different.

Covers:
  - Monitoring context_status on every response
  - HTTP 409 (context_exhausted) → /v1/chat/new → retry
  - HTTP 503 (server_busy)       → save state, wait for restart
  - HTTP 401 (invalid_key)       → re-register
  - HTTP 504 (timeout)           → retry with backoff
  - /v1/chat/new {restore: true/false}
  - /v1/context/status
  - /v1/chat/single  (temporary chat)

Key concepts (see docs/guides/session-management.md):

  Two limits, not one
  -------------------
  * CHARS_LIMIT (context_status.chars_limit) is OUR estimate:
    1_000_000 tokens × language_coefficient.
  * deepseek_length_limit.readable_percent is the REAL limit — what
    DeepSeek actually read. It appears only at the moment of overflow.

  Graceful degradation
  --------------------
  When the chat reaches the limit, the server transitions to a NEW chat.
  Snapshot and RAG transfer only a fraction of the old context. Even
  with both enabled, the model treats the transferred data as a
  DOCUMENT, not as its own memory. Quality drops after every transition.

  Client responsibilities
  -----------------------
  1. Check context_status on every successful response.
  2. Log warning changes (null → context_above_70 → context_near_limit).
  3. On 409: read recovery, call /v1/chat/new, retry.
  4. On 503: do NOT retry — the server is shutting down.
  5. On 401: re-register.
  6. On 504: retry with exponential backoff.
  7. Keep critical facts in the system message — not in messages[].
"""

import sys
import time

import requests

from common import (
    BASE_URL, banner, section,
    load_or_register_key, print_response, print_context_status,
)


# =====================================================================
# Core: send a message with full error handling
# =====================================================================

class SessionLost(Exception):
    """Raised when the session cannot be recovered automatically."""


def send_message(
    api_key: str,
    messages: list,
    *,
    extra_body: dict | None = None,
    max_retries: int = 3,
) -> dict:
    """
    Send a message with the full client-side protocol.

    Returns the successful response payload (dict).
    Raises SessionLost if the session cannot be recovered.
    """
    payload: dict = {"messages": messages}
    if extra_body:
        payload["extra_body"] = extra_body

    attempt = 0
    backoff = 1.0

    while True:
        attempt += 1
        try:
            r = requests.post(
                f"{BASE_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=300,
            )
        except requests.Timeout:
            # Client-side timeout — treat like 504 below.
            r = None

        # ---- 200 ----
        if r is not None and r.status_code == 200:
            data = r.json()
            print_context_status(data)
            return data

        # ---- 400 validation ----
        if r is not None and r.status_code == 400:
            print(f"✗ Validation error: {r.text}", file=sys.stderr)
            raise SessionLost("validation_error")

        # ---- 401 invalid key ----
        if r is not None and r.status_code == 401:
            print("✗ Invalid API key. Re-register via /v1/register.", file=sys.stderr)
            raise SessionLost("invalid_key")

        # ---- 409 context exhausted ----
        if r is not None and r.status_code == 409:
            err = r.json().get("error", {})
            print(
                f"⚠ Context exhausted: {err.get('chars_used')} / "
                f"{err.get('chars_limit')} chars",
                file=sys.stderr,
            )
            print(
                f"  DeepSeek readable: {err.get('deepseek_readable_percent')}%",
                file=sys.stderr,
            )
            print(f"  RAG preserved: {err.get('rag_enabled')}", file=sys.stderr)
            print(f"  Recovery: {err.get('recovery')}", file=sys.stderr)

            # Transition to a new chat. Do NOT retry in the same chat —
            # it will return 409 again.
            _start_new_chat(api_key, restore=False)

            # Retry the original request in the new chat. Context is
            # smaller now, so this should succeed. We do not increment
            # `attempt` for this retry: the previous request did not
            # count as a real attempt.
            attempt -= 1
            continue

        # ---- 503 server busy ----
        if r is not None and r.status_code == 503:
            print("🚫 DeepSeek server busy.", file=sys.stderr)
            print(
                "  The server will shut down in ~500 ms by design. "
                "Wait for an external supervisor to restart it.",
                file=sys.stderr,
            )
            # Do NOT retry. The server is going down.
            raise SessionLost("server_busy")

        # ---- 504 timeout (or client-side timeout) ----
        is_504 = (r is not None and r.status_code == 504) or r is None
        if is_504:
            if attempt > max_retries:
                print(
                    f"✗ Timeout after {max_retries} attempts. Giving up.",
                    file=sys.stderr,
                )
                raise SessionLost("timeout")

            print(
                f"⏱ Timeout on attempt {attempt}/{max_retries}. "
                f"Retry in {backoff:.1f}s...",
                file=sys.stderr,
            )
            time.sleep(backoff)
            backoff *= 2
            continue

        # ---- Anything else ----
        print(f"✗ Unexpected HTTP {r.status_code}: {r.text}", file=sys.stderr)
        raise SessionLost(f"http_{r.status_code}")


# =====================================================================
# Session helpers
# =====================================================================

def _start_new_chat(api_key: str, restore: bool) -> None:
    """
    POST /v1/chat/new.

    restore=False: fresh chat. RAG index cleared. Use after 409.
    restore=True:  reopen last chat. RAG index preserved. Use only when
                   you explicitly want the previous chat back.
    """
    r = requests.post(
        f"{BASE_URL}/v1/chat/new",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={"restore": restore},
        timeout=120,
    )

    if r.status_code == 200:
        mode = "restore" if restore else "fresh"
        print(f"  → New chat ({mode}).")
        return

    if r.status_code == 409:
        err = r.json().get("error", {})
        print(f"  ⚠ Restore failed: {err.get('reason')}", file=sys.stderr)
        print(f"    {err.get('message')}", file=sys.stderr)
        print(f"    state_cleared: {err.get('state_cleared')}", file=sys.stderr)
        # If restore failed, do a fresh start so the next request has a
        # valid session.
        _start_new_chat(api_key, restore=False)
        return

    print(f"  ✗ /v1/chat/new failed: HTTP {r.status_code}", file=sys.stderr)


def get_context_status(api_key: str) -> dict:
    """
    GET /v1/context/status — cheap health check.

    Returns:
        { totalChars, maxChars, percent, snapshot70Done, snapshot90Done }
    """
    r = requests.get(
        f"{BASE_URL}/v1/context/status",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


# =====================================================================
# 1. Monitor context_status
# =====================================================================

def example_monitor(api_key: str) -> None:
    """
    Send a short message and watch context_status grow.

    In a real client, you would log every change of `warning`:
        null → context_above_70 → context_near_limit
    and prepare for the transition when it crosses 70%.
    """
    section("Example 1: monitor context_status")

    before = get_context_status(api_key)
    print(f"  before: {before['totalChars']:,} / {before['maxChars']:,} "
          f"({before['percent']}%)")

    messages = [{"role": "user", "content": "Say one word: OK."}]
    send_message(api_key, messages)

    after = get_context_status(api_key)
    print(f"  after:  {after['totalChars']:,} / {after['maxChars']:,} "
          f"({after['percent']}%)")


# =====================================================================
# 2. Simulating a 409
# =====================================================================

def example_handle_409(api_key: str) -> None:
    """
    We cannot force a real 409 without filling the context, but the
    error path in send_message() is the one used in production. This
    example demonstrates the /v1/chat/new call directly.

    In a real scenario:
      1. A normal request returns 409 with error.type=context_exhausted.
      2. send_message() catches it, prints the recovery info,
         calls _start_new_chat(restore=False), and retries.
      3. The retry succeeds because the new chat has an empty context.
    """
    section("Example 2: recover after context exhaustion")

    print("  Forcing a fresh chat (as if 409 had just been returned)...")
    _start_new_chat(api_key, restore=False)

    # Retry the original request. It now runs in the new chat.
    messages = [{"role": "user", "content": "We started over. Acknowledge."}]
    send_message(api_key, messages)


# =====================================================================
# 3. Restore vs fresh
# =====================================================================

def example_restore_vs_fresh(api_key: str) -> None:
    """
    /v1/chat/new has two modes:

      restore=False → new chat, RAG index cleared. Start a fresh topic.
      restore=True  → reopen last chat, RAG index preserved. Continue
                       the previous topic.

    If restore=True fails (chat not found, no last id), the server
    returns 409 with error.type=restore_failed and clears the state.
    A fresh start is the only recovery.
    """
    section("Example 3: restore vs fresh")

    print("  → fresh chat")
    _start_new_chat(api_key, restore=False)
    send_message(api_key, [{"role": "user", "content": "Say: fresh."}])

    print("\n  → restore last chat")
    _start_new_chat(api_key, restore=True)
    send_message(api_key, [{"role": "user", "content": "Say: restored."}])


# =====================================================================
# 4. Degradation of quality — what to expect
# =====================================================================

def example_graceful_degradation(api_key: str) -> None:
    """
    After a transition, the model does NOT remember everything.
    Snapshot and RAG transfer only a fraction of the old context.

    Practical consequence: keep critical facts in the system message,
    not in the conversation history. The system message is resent on
    every request and survives every transition.
    """
    section("Example 4: degradation and the system message")

    system = (
        "Context that must survive any transition:\n"
        "  Project: DeepSeek Automation API.\n"
        "  Maintainer: Alice.\n"
        "  Deadline: 2026-10-01.\n"
        "Refer to these facts in every answer."
    )

    # Fresh chat — as if we just transitioned.
    _start_new_chat(api_key, restore=False)

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": "Who is the maintainer?"},
    ]
    data = send_message(api_key, messages)
    print(f"  Answer includes 'Alice'? "
          f"{'Alice' in data['choices'][0]['message']['content']}")


# =====================================================================
# 5. Temporary chat (/v1/chat/single)
# =====================================================================

def example_single(api_key: str) -> None:
    """
    POST /v1/chat/single — run a request in a temporary chat.

    The main session is not touched: whatever you say in the temporary
    chat does not enter the main context, does not increase totalChars,
    and does not trigger snapshots or transitions.

    Optional flags:
      insert_to_context=true — append the answer to the main chat as a
                               System message.
      return_only=true       — return only {"answer": "..."}.
    """
    section("Example 5: temporary chat (/v1/chat/single)")

    messages_json = '[{"role":"user","content":"Answer briefly: what is 2+2?"}]'

    r = requests.post(
        f"{BASE_URL}/v1/chat/single",
        headers={"Authorization": f"Bearer {api_key}"},
        files={"messages": (None, messages_json)},
        timeout=180,
    )

    if r.status_code != 200:
        print(f"✗ HTTP {r.status_code}: {r.text}", file=sys.stderr)
        return

    data = r.json()
    print(f"✓ {data.get('answer', '')[:120]}")
    print(f"  inserted into main context: {data.get('inserted')}")


# =====================================================================
# Main
# =====================================================================

def main() -> None:
    banner("05 — Session management and error handling")
    api_key = load_or_register_key()

    try:
        example_monitor(api_key)
        example_handle_409(api_key)
        example_restore_vs_fresh(api_key)
        example_graceful_degradation(api_key)
        example_single(api_key)
    except SessionLost as e:
        print(f"\n✗ Session lost: {e}", file=sys.stderr)
        sys.exit(1)

    banner("Done.")


if __name__ == "__main__":
    main()