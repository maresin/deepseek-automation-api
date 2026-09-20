"""
05 — Session management and error handling.

The other examples assume the session never overflows and the network
is reliable. Real usage is different.

Two independent limits
──────────────────────
  context_status.chars_limit           — our estimate:
                                          1_000_000 tokens × language_coefficient
  context_status.deepseek_length_      — the real limit DeepSeek actually read
    limit.readable_percent               (appears only when the banner fires)

The estimate is intentionally the EARLIER of the two. Transitions are
triggered by the estimate; the real banner is an emergency path.

Graceful degradation
────────────────────
When a chat reaches the limit, the server transitions to a NEW chat.
Snapshot and RAG transfer only a fraction of the old context. Even with
both enabled, the model treats the transferred content as a DOCUMENT,
not as its own memory. Quality drops after every transition.

Client responsibilities
───────────────────────
  1. Inspect context_status on EVERY successful response.
  2. Log warning changes: null → context_above_70 → context_near_limit.
  3. On 409 context_exhausted: call /v1/chat/new, retry.
  4. On 503 server_busy: do NOT retry — the server is shutting down.
  5. On 401 invalid_key: re-register via /v1/register.
  6. On 504 timeout: retry with exponential backoff.
  7. Keep critical facts in the system message — not in messages[].

    pip install requests
    python 05_session.py

Full protocol: docs/guides/session-management.md
"""

import sys
import time

import requests

BASE_URL = "http://localhost:3000"
API_KEY = "deepseek_..."  # replace


# ─────────────────────────────────────────────────────────────────────
# The core: chat() with full error handling
# ─────────────────────────────────────────────────────────────────────
#
# One function, because retry logic must live somewhere. Everything
# else in this file is either documentation or a demo call.

def chat(messages, extra_body=None, max_retries=3):
    """
    Send a chat request with full error handling.

    Returns the parsed response dict on success.
    Raises RuntimeError or TimeoutError on unrecoverable errors.
    """
    payload = {"messages": messages}
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
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=300,
            )
        except requests.Timeout:
            r = None

        # ─── 200 OK ────────────────────────────────────────────
        if r is not None and r.status_code == 200:
            data = r.json()
            _print_context_status(data)
            return data

        # ─── 400 Validation error ──────────────────────────────
        # Bad messages, bad tools, bad extra_body. Retrying will not
        # help — the request itself is malformed.
        if r is not None and r.status_code == 400:
            raise RuntimeError(f"Validation error: {r.text}")

        # ─── 401 Invalid key ───────────────────────────────────
        # The key does not match the server's .api-key. Re-register.
        if r is not None and r.status_code == 401:
            raise RuntimeError("Invalid API key. Call /v1/register.")

        # ─── 409 Context exhausted ─────────────────────────────
        # The current chat is full. Start a new one, retry the same
        # request. The retry does NOT count as a new attempt — the
        # previous request was valid, it just hit the limit.
        if r is not None and r.status_code == 409:
            err = r.json().get("error", {})
            print(
                f"⚠ Context exhausted: "
                f"{err.get('chars_used')} / {err.get('chars_limit')} chars",
                file=sys.stderr,
            )
            print(
                f"  DeepSeek readable: {err.get('deepseek_readable_percent')}%",
                file=sys.stderr,
            )
            print(f"  RAG preserved: {err.get('rag_enabled')}", file=sys.stderr)

            _new_chat(restore=False)
            attempt -= 1  # do not count this as a retry
            continue

        # ─── 503 Server busy ───────────────────────────────────
        # DeepSeek backend refusing. The server shuts down by design
        # after responding. Retrying is pointless for hours.
        if r is not None and r.status_code == 503:
            raise RuntimeError("Server busy. Wait for restart.")

        # ─── 504 Timeout ───────────────────────────────────────
        # The server did not get an answer from DeepSeek within its
        # own timeout, or the client timed out. Retry with backoff.
        is_timeout = (r is not None and r.status_code == 504) or r is None
        if is_timeout:
            if attempt > max_retries:
                raise TimeoutError(f"Timeout after {max_retries} attempts.")
            time.sleep(backoff)
            backoff *= 2
            continue

        # ─── Anything else ─────────────────────────────────────
        raise RuntimeError(f"Unexpected HTTP {r.status_code}: {r.text}")


# ─────────────────────────────────────────────────────────────────────
# Session helpers
# ─────────────────────────────────────────────────────────────────────

def _new_chat(restore=False):
    """
    POST /v1/chat/new.

    restore=False — fresh chat, RAG index cleared. Use after 409.
    restore=True  — reopen the last chat, RAG index preserved.
    """
    r = requests.post(
        f"{BASE_URL}/v1/chat/new",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={"restore": restore},
        timeout=120,
    )
    if r.status_code == 200:
        print(f"  → New chat ({'restore' if restore else 'fresh'}).")
    elif r.status_code == 409:
        err = r.json().get("error", {})
        print(
            f"  ⚠ Restore failed: {err.get('reason')} — falling back to fresh.",
            file=sys.stderr,
        )
        _new_chat(restore=False)
    else:
        print(f"  ✗ /v1/chat/new failed: HTTP {r.status_code}", file=sys.stderr)


def _context_status():
    """GET /v1/context/status — cheap health check."""
    r = requests.get(
        f"{BASE_URL}/v1/context/status",
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=10,
    )
    return r.json()


def _print_context_status(data):
    """Print the context_status block from a chat response."""
    status = data.get("context_status")
    if not status:
        return
    used = status["chars_used"]
    limit = status["chars_limit"]
    pct = status["percent_used"]
    print(f"  context: {used:,} / {limit:,} chars ({pct}%)")
    if status.get("warning"):
        print(f"  ⚠ {status['warning']} → {status['recommendation']}")


# ─────────────────────────────────────────────────────────────────────
# Demo
# ─────────────────────────────────────────────────────────────────────

# Baseline: where are we?
print("Before:", _context_status())
# → {"totalChars": 0, "maxChars": 2400000, "percent": 0, ...}

# A normal request. chat() handles the happy path and prints
# context_status for you.
chat([{"role": "user", "content": "Say one word: ready."}])
# → context: 28 / 2,400,000 chars (0%)

# Force a fresh chat, as if a 409 had just been returned. In a real
# client this happens automatically inside chat() — the call here is
# only so the demo shows the flow.
_new_chat(restore=False)

# Send the same request in the new chat. It should succeed.
chat([{"role": "user", "content": "Say one word: fresh."}])


# ─────────────────────────────────────────────────────────────────────
# A note on the system message
# ─────────────────────────────────────────────────────────────────────
#
# After a transition, the model does NOT remember everything. Even
# with both Snapshot and RAG enabled, it treats the transferred
# content as a document.
#
# The system message is different: it is resent on every request and
# survives every transition. Put facts that must persist there, not
# in the conversation history.

chat([
    {"role": "system", "content":
        "Reference facts for this session:\n"
        "  Maintainer: Alice\n"
        "  Deadline: 2026-10-01\n"
        "Refer to these in every answer."},
    {"role": "user", "content": "Who is the maintainer?"},
])
# The answer includes "Alice" — the system message survives any chat
# switch.
#
# Full protocol: docs/guides/session-management.md