#!/usr/bin/env python3
"""
Two-agent pipeline demo.

Agent A (researcher) generates facts about a topic.
Agent B (writer) drafts an introduction based on those facts.
Agent A critiques the draft.
Agent B revises.

This is not a "hello world" — it is a working orchestration loop that
exercises context tracking, error recovery, and the two-agent split.
Both agents run in parallel processes with their own chats and context
counters. The only thing they share is the DeepSeek cookie session.

    pip install requests
    python demo_client.py
"""

import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent

AGENTS = {
    "researcher": {
        "url": "http://localhost:3000",
        "key_file": HERE / ".api-key-a",
    },
    "writer": {
        "url": "http://localhost:3001",
        "key_file": HERE / ".api-key-b",
    },
}

TOPIC = "the Fermi paradox"


# ---- readiness check ----------------------------------------------
#
# /health only confirms that the HTTP server is listening, which
# happens seconds before the DeepSeek client is initialised. Polling
# /v1/context/status with the agent's key distinguishes:
#   200 → ready
#   401 → wrong key
#   503 → still initialising

def wait_for_ready(url: str, key_file: Path, timeout: int = 180) -> bool:
    """Poll /v1/context/status until the client is up (200), or time out."""
    if not key_file.exists():
        print(f"   ✗ Key file not found: {key_file}", file=sys.stderr)
        return False

    key = key_file.read_text().strip()
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            r = requests.get(
                f"{url}/v1/context/status",
                headers={"Authorization": f"Bearer {key}"},
                timeout=5,
            )
            if r.status_code == 200:
                return True
            if r.status_code == 401:
                print(f"   ✗ {url} rejected key from {key_file.name}",
                      file=sys.stderr)
                return False
            # 503 → still initialising; keep polling
        except requests.RequestException:
            pass
        time.sleep(1)

    return False


# ---- core ---------------------------------------------------------

def ask(agent: str, content: str, retries: int = 3) -> str:
    """
    Send a message to an agent, handling the four recoverable error
    codes per the client protocol. Returns the assistant text.
    """
    if agent not in AGENTS:
        raise ValueError(f"Unknown agent: {agent}")

    url = AGENTS[agent]["url"]
    key = AGENTS[agent]["key_file"].read_text().strip()

    backoff = 1.0
    attempt = 0

    while True:
        attempt += 1

        try:
            r = requests.post(
                f"{url}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={"messages": [{"role": "user", "content": content}]},
                timeout=300,
            )
        except requests.Timeout:
            if attempt > retries:
                raise TimeoutError(f"{agent} timed out after {retries} retries")
            print(f"   ⏱  {agent} timed out, retry in {backoff:.0f}s...")
            time.sleep(backoff)
            backoff *= 2
            continue

        # ---- 200 OK ---------------------------------------------
        if r.status_code == 200:
            data = r.json()
            _print_context(agent, data.get("context_status", {}))
            return data["choices"][0]["message"]["content"]

        # ---- 400 bad request -----------------------------------
        if r.status_code == 400:
            raise RuntimeError(f"{agent} rejected the request: {r.text}")

        # ---- 401 invalid key -----------------------------------
        if r.status_code == 401:
            raise RuntimeError(
                f"{agent} rejected the API key. "
                f"Check {AGENTS[agent]['key_file']}."
            )

        # ---- 409 context exhausted -----------------------------
        if r.status_code == 409:
            err = r.json().get("error", {})
            print(f"   ⚠  {agent} context exhausted "
                  f"({err.get('chars_used')}/{err.get('chars_limit')})")
            print(f"      DeepSeek readable: "
                  f"{err.get('deepseek_readable_percent')}%")
            print(f"      RAG preserved: {err.get('rag_enabled')}")
            print(f"   →  {agent}: starting fresh chat and retrying")
            requests.post(
                f"{url}/v1/chat/new",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={"restore": False},
                timeout=120,
            )
            # Retry does not count against the budget: the previous
            # request was valid, it just hit the limit.
            attempt -= 1
            continue

        # ---- 503 service unavailable ---------------------------
        # Two distinct causes produce 503:
        #   1. ServerBusyError       — DeepSeek returned the "Server
        #                              busy" placeholder. Fatal; the
        #                              process exits by design.
        #   2. Client-not-ready      — the HTTP server is listening
        #                              but the DeepSeek client has
        #                              not finished initialising.
        #                              Transient; retry.
        # The body distinguishes them:
        #   {"error": {"type": "server_busy", ...}}   ← case 1
        #   {"error": "Client not ready. ..."}        ← case 2
        if r.status_code == 503:
            try:
                body = r.json()
            except Exception:
                body = {"raw": r.text[:400]}

            err_field = body.get("error")
            if isinstance(err_field, dict) and err_field.get("type") == "server_busy":
                raise RuntimeError(
                    f"{agent} reported server busy. The process shuts "
                    f"down by design — wait for a supervisor to restart it."
                )

            # Client-not-ready or transient unavailability: retry.
            msg = err_field if isinstance(err_field, str) else str(body)
            if attempt > retries:
                raise RuntimeError(
                    f"{agent} still not ready after {retries} retries: {body}"
                )
            print(f"   ⏱  {agent} not ready ({msg}), retry in {backoff:.0f}s...")
            time.sleep(backoff)
            backoff *= 2
            continue

        # ---- 504 timeout ---------------------------------------
        if r.status_code == 504:
            if attempt > retries:
                raise TimeoutError(f"{agent} timed out after {retries} retries")
            print(f"   ⏱  {agent} returned 504, retry in {backoff:.0f}s...")
            time.sleep(backoff)
            backoff *= 2
            continue

        raise RuntimeError(f"{agent} returned HTTP {r.status_code}: {r.text}")


def _print_context(agent: str, status: dict) -> None:
    if not status:
        return
    used = status.get("chars_used", 0)
    limit = status.get("chars_limit", 0)
    pct = status.get("percent_used", 0)
    print(f"   [{agent}] context: {used:,} / {limit:,} chars ({pct}%)")
    warning = status.get("warning")
    if warning:
        print(f"   [{agent}] ⚠  {warning} → {status.get('recommendation')}")


# ---- pipeline -----------------------------------------------------

def run_pipeline(topic: str) -> str:
    print(f"Topic: {topic}")
    print()

    print("1/4  Researcher: gather three facts")
    facts = ask(
        "researcher",
        f"List three concrete, verifiable facts about {topic}. "
        f"Be terse — plain list, no preamble.",
    )
    print(f"     → {facts[:120]}{'...' if len(facts) > 120 else ''}")
    print()

    print("2/4  Writer: draft an introduction")
    draft = ask(
        "writer",
        f"Write a two-paragraph introduction about {topic} "
        f"using these facts:\n\n{facts}",
    )
    print(f"     → {draft[:120]}{'...' if len(draft) > 120 else ''}")
    print()

    print("3/4  Researcher: critique the draft")
    critique = ask(
        "researcher",
        f"Here is a draft introduction about {topic}:\n\n{draft}\n\n"
        f"Point out any factual errors or unsupported claims in a "
        f"short bullet list. If there are none, say so.",
    )
    print(f"     → {critique[:120]}{'...' if len(critique) > 120 else ''}")
    print()

    print("4/4  Writer: revise based on the critique")
    revision = ask(
        "writer",
        f"Revise this introduction, addressing the critique:\n\n"
        f"Draft:\n{draft}\n\nCritique:\n{critique}",
    )
    print()

    return revision


# ---- entry --------------------------------------------------------

def main() -> int:
    # Wait for both agents to fully initialise. A listening HTTP
    # port is not enough — the DeepSeek client comes up 15–30s later.
    for name, info in AGENTS.items():
        print(f"→ Waiting for {name} to become ready...")
        if not wait_for_ready(info["url"], info["key_file"]):
            print(f"✗ {name} at {info['url']} did not become ready",
                  file=sys.stderr)
            print(f"  Check the agent log; start-all.sh does the same.",
                  file=sys.stderr)
            return 1

    t0 = time.time()
    try:
        final = run_pipeline(TOPIC)
    except Exception as e:
        print(f"\n✗ Pipeline failed: {e}", file=sys.stderr)
        return 1

    elapsed = time.time() - t0

    print("=" * 60)
    print("Final revision:")
    print("=" * 60)
    print(final)
    print("=" * 60)
    print(f"Total wall time: {elapsed:.1f}s")
    print("(Two-agent split: the two LLM calls within a stage run "
          "sequentially, but stages could be parallelised.)")

    return 0


if __name__ == "__main__":
    sys.exit(main())