#!/usr/bin/env python3
"""
Step 41: bound the 409 reset loop in demo_client.py.

The 409 handler resets the chat and does `attempt -= 1` with the
comment "retry does not count against the budget". That is correct
in intent — a 409 is a state problem, not a transient error, and
should not consume the transient-error retry budget. But it is
unbounded: if the server keeps returning 409 (misconfigured agent,
persistent overflow), the loop runs forever.

Fix: add a separate counter, context_resets, capped at
MAX_CONTEXT_RESETS = 2. The third consecutive 409 raises a clear
RuntimeError instead of spinning. The transient-error budget is
untouched, so the original intent is preserved.

Gate:
  - python3 -m py_compile,
  - smoke test: local HTTP server that always returns 409; the
    client must raise within a bounded time instead of looping.

Rollback: cp -r .backup/dev-snapshot-v5/* .
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def find_api_root() -> Path:
    env = os.environ.get("API_ROOT")
    if env:
        p = Path(env).resolve()
        if (p / "server.js").exists():
            return p
        raise SystemExit(f"API_ROOT={env} does not contain server.js")
    here = Path(__file__).resolve()
    candidate = here.parent.parent.parent
    if (candidate / "server.js").exists():
        return candidate
    if len(sys.argv) > 1:
        p = Path(sys.argv[1]).resolve()
        if (p / "server.js").exists():
            return p
        raise SystemExit(f"{p} does not contain server.js")
    raise SystemExit(
        "Cannot find API root. Set API_ROOT env var, pass it as first\n"
        "argument, or place this script under <api-root>/tools/dev/."
    )


ROOT = find_api_root()
BACKUP = ROOT / ".backup" / "dev-snapshot-v5"
TARGET = "examples/two-agent-pipeline/demo_client.py"


def backup(rel: str) -> None:
    src = ROOT / rel
    if not src.exists():
        return
    dst = BACKUP / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def patch(rel: str, pairs: list) -> int:
    p = ROOT / rel
    if not p.exists():
        print(f"  x {rel}: not found")
        return -1
    text = p.read_text(encoding="utf-8")
    original = text
    total = 0
    for old, new in pairs:
        if old == new:
            continue
        old_present = old in text
        new_present = (new == "") or (new in text)
        substring_case = (new != "") and (new in old)

        if not old_present:
            if new_present:
                print(f"  = {rel}: already patched ({old[:40]!r})")
                continue
            print(f"  x {rel}: pattern not found; expected:")
            print(f"    {old[:200]!r}")
            return -1

        if new_present and not substring_case:
            print(f"  x {rel}: both old and new present - file drifted")
            return -1

        n = text.count(old)
        if n > 1:
            print(f"  x {rel}: pattern appears {n} times; aborting")
            return -1
        text = text.replace(old, new, 1)
        total += n
        print(f"  + {rel}: {old[:50]!r}")

    if text != original:
        backup(rel)
        p.write_text(text, encoding="utf-8")
    return total


def run(cmd: list, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, capture_output=capture, text=True)


def py_compile(rel: str) -> bool:
    print(f"  python3 -m py_compile {rel}")
    r = run(["python3", "-m", "py_compile", str(ROOT / rel)], capture=True)
    if r.returncode != 0:
        print(f"    x {r.stderr.strip()[:200]}")
        return False
    return True


def git_commit(message: str) -> None:
    if not (ROOT / ".git").exists():
        print("  git: no repo, skipping commit")
        return
    try:
        subprocess.run(["git", "add", "-A"], cwd=ROOT,
                       check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", message], cwd=ROOT,
                       check=True, capture_output=True)
        print(f'  git: committed "{message}"')
    except subprocess.CalledProcessError as e:
        print(f"  git: commit failed ({e})")


# ---------------------------------------------------------------------------
# Patches
# ---------------------------------------------------------------------------

INIT_OLD = """    backoff = 1.0
    attempt = 0

    while True:
        attempt += 1

        try:
            status, body_text = http_post(url, payload, headers, timeout=300.0)"""

INIT_NEW = """    backoff = 1.0
    attempt = 0
    # A 409 is a state problem, not a transient error, so it does not
    # consume the retry budget. But it must be bounded: if the server
    # keeps returning 409 after a chat reset (misconfigured agent,
    # persistent overflow), the loop would otherwise spin forever.
    context_resets = 0
    MAX_CONTEXT_RESETS = 2

    while True:
        attempt += 1

        try:
            status, body_text = http_post(url, payload, headers, timeout=300.0)"""


HANDLER_OLD = """        # ---- 409 context exhausted -----------------------------
        if status == 409:
            err: dict[str, Any] = {}
            try:
                err = json.loads(body_text).get("error", {})
            except (ValueError, AttributeError):
                pass
            print(f"   ⚠  {agent['name']} context exhausted "
                  f"({err.get('chars_used')}/{err.get('chars_limit')})")
            print(f"   →  starting fresh chat and retrying")
            http_post(
                f"http://127.0.0.1:{port}/v1/chat/new",
                {"restore": False},
                headers,
                timeout=120.0,
            )
            attempt -= 1  # retry does not count against the budget
            continue"""

HANDLER_NEW = """        # ---- 409 context exhausted -----------------------------
        if status == 409:
            context_resets += 1
            if context_resets > MAX_CONTEXT_RESETS:
                raise RuntimeError(
                    f"{agent['name']} context exhausted "
                    f"{context_resets} times in a row; giving up"
                )
            err: dict[str, Any] = {}
            try:
                err = json.loads(body_text).get("error", {})
            except (ValueError, AttributeError):
                pass
            print(f"   ⚠  {agent['name']} context exhausted "
                  f"({err.get('chars_used')}/{err.get('chars_limit')})")
            print(f"   →  starting fresh chat "
                  f"({context_resets}/{MAX_CONTEXT_RESETS})")
            http_post(
                f"http://127.0.0.1:{port}/v1/chat/new",
                {"restore": False},
                headers,
                timeout=120.0,
            )
            attempt -= 1  # does not count against the retry budget
            continue"""


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------

SMOKE_SCRIPT = r'''
import http.server
import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

TARGET = Path(sys.argv[1])

spec = importlib.util.spec_from_file_location("demo_client", TARGET)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Always409(http.server.BaseHTTPRequestHandler):
    posts = 0

    def do_POST(self):
        Always409.posts += 1
        self.send_response(409)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error":{"type":"context_exhausted"}}')

    def log_message(self, *a, **k):
        pass


server = http.server.HTTPServer(("127.0.0.1", 0), Always409)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

agent = {"name": "probe", "port": port, "key": "k", "dir": Path(".")}

started = time.time()
try:
    mod.ask(agent, "hello", retries=3)
except RuntimeError as e:
    elapsed = time.time() - started
    # Expect 3 POST /v1/chat/completions + 2 POST /v1/chat/new = 5 posts.
    # The cap is 2 resets, so the 3rd 409 raises.
    print(f"raised in {elapsed:.2f}s after {Always409.posts} POSTs")
    if Always409.posts != 5:
        print(f"FAIL: expected 5 POSTs (3 chat + 2 reset), got {Always409.posts}")
        sys.exit(1)
    if elapsed > 30:
        print(f"FAIL: took too long ({elapsed:.1f}s)")
        sys.exit(1)
    print("OK")
    sys.exit(0)
except Exception as e:
    print(f"FAIL: unexpected exception {type(e).__name__}: {e}")
    sys.exit(2)
else:
    print("FAIL: ask() returned instead of raising")
    sys.exit(3)
'''


def smoke_bounded_409() -> bool:
    print("  - repeated 409 raises after MAX_CONTEXT_RESETS")

    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(SMOKE_SCRIPT)
        script = f.name

    try:
        r = subprocess.run(
            ["python3", script, str(ROOT / TARGET)],
            capture_output=True, text=True, timeout=60,
        )
    finally:
        os.unlink(script)

    print(f"    stdout: {r.stdout.strip()[:200]}")
    if r.returncode != 0:
        print(f"    x smoke test exited {r.returncode}")
        if r.stderr.strip():
            print(f"      stderr: {r.stderr.strip()[:300]}")
        return False
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print(f"API root: {ROOT}")
    BACKUP.mkdir(parents=True, exist_ok=True)

    print()
    print("--- patch ---")
    if patch(TARGET, [(INIT_OLD, INIT_NEW), (HANDLER_OLD, HANDLER_NEW)]) < 0:
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 2

    print()
    print("=== syntax ===")
    if not py_compile(TARGET):
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 3

    print()
    print("=== smoke test ===")
    if not smoke_bounded_409():
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 4

    print()
    print("=== Commit ===")
    git_commit("step41: cap 409 chat resets in demo_client.py")

    print()
    print(f"Done. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
    return 0


if __name__ == "__main__":
    sys.exit(main())