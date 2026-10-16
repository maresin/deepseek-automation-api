#!/usr/bin/env python3
"""
Step 42: kill-by-port fallback without npx.

stop-all.sh falls back to `npx --yes kill-port <port>` when a PID
file is missing or stale. npx downloads the package from npm on
first invocation; on an air-gapped machine, or when npm is slow or
blocked, this silently fails (the command is `|| true`). The port
stays occupied and the next start-all.sh refuses to run.

Fix: add kill_port_local() to lib/common.sh, using lsof → ss →
fuser (whichever is present). No network, no npm. stop-all.sh
calls it; if none of the three tools is available, it prints a
hint instead of doing nothing.

Gate:
  - bash -n on both patched scripts,
  - shellcheck if installed,
  - smoke test: start a Node listener on a free port, source
    common.sh, call kill_port_local, assert the port is freed.

Rollback: cp -r .backup/dev-snapshot-v3/* .
"""

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
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
BACKUP = ROOT / ".backup" / "dev-snapshot-v3"
COMMON = "tools/templates/lib/common.sh"
STOP = "tools/templates/stop-all.sh"


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
            print(f"    {old[:160]!r}")
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


def bash_n(rel: str) -> bool:
    print(f"  bash -n {rel}")
    r = run(["bash", "-n", str(ROOT / rel)], capture=True)
    if r.returncode != 0:
        print(f"    x {r.stderr.strip()[:200]}")
        return False
    return True


def shellcheck(rel: str) -> bool:
    if shutil.which("shellcheck") is None:
        print(f"  shellcheck: skipped ({rel})")
        return True
    print(f"  shellcheck {rel}")
    r = run(["shellcheck", "--severity=error", str(ROOT / rel)], capture=True)
    if r.returncode != 0:
        print(f"    x {r.stdout.strip()[:300]}")
        return False
    return True


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def smoke_kill_port_local() -> bool:
    print("  - kill_port_local frees an occupied port")
    node = shutil.which("node")
    if node is None:
        print("    ~ node not installed, skipping")
        return True

    port = free_port()
    proc = subprocess.Popen(
        [node, "-e",
         f"require('net').createServer().listen({port}, '127.0.0.1')"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            if port_open(port):
                break
            time.sleep(0.1)
        else:
            print("    x node listener never came up")
            return False

        with tempfile.NamedTemporaryFile("w", suffix=".sh",
                                         delete=False) as f:
            f.write(
                "set -euo pipefail\n"
                f'source "{ROOT / COMMON}"\n'
                f'kill_port_local "{port}"\n'
            )
            script = f.name

        try:
            r = subprocess.run(["bash", script], capture_output=True, text=True)
        finally:
            os.unlink(script)

        if r.returncode != 0:
            print(f"    x kill_port_local returned {r.returncode}")
            print(f"      stderr: {r.stderr.strip()[:200]}")
            return False

        for _ in range(20):
            if not port_open(port):
                break
            time.sleep(0.1)
        else:
            print(f"    x port {port} still open after kill_port_local")
            return False
        return True
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()


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

COMMON_ANCHOR = "# Poll /v1/context/status until the given agent returns 200."

COMMON_INSERT = '''# Kill whatever process is listening on <port>, without npx and
# without network access. Tries lsof, then ss, then fuser. Returns 0
# if the port was occupied and the kill succeeded (or cannot be
# verified), 1 if the port was already free or no tool is available.
kill_port_local() {
    local port="$1"
    [[ -z "$port" ]] && return 1

    local pids

    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
        [[ -z "$pids" ]] && return 1
        echo "$pids" | xargs -r kill 2>/dev/null || true
        sleep 1
        pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
        if [[ -n "$pids" ]]; then
            echo "$pids" | xargs -r kill -9 2>/dev/null || true
        fi
        return 0
    fi

    if command -v ss >/dev/null 2>&1; then
        pids="$(ss -ltnp "sport = :${port}" 2>/dev/null \\
            | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
        [[ -z "$pids" ]] && return 1
        echo "$pids" | xargs -r kill 2>/dev/null || true
        sleep 1
        pids="$(ss -ltnp "sport = :${port}" 2>/dev/null \\
            | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
        if [[ -n "$pids" ]]; then
            echo "$pids" | xargs -r kill -9 2>/dev/null || true
        fi
        return 0
    fi

    if command -v fuser >/dev/null 2>&1; then
        fuser -k "${port}/tcp" >/dev/null 2>&1 || true
        return 0
    fi

    return 1
}

'''

STOP_OLD = """    # Fallback: is anything still on the port?
    port="$(read_kv "$agent_dir/agent.env" PORT 2>/dev/null || true)"
    if [[ -n "$port" ]] && curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
        if command -v npx >/dev/null 2>&1; then
            echo "→ $name still on port $port — using kill-port"
            npx --yes kill-port "$port" >/dev/null 2>&1 || true
            stopped=1
        fi
    fi"""

STOP_NEW = """    # Fallback: is anything still on the port?
    port="$(read_kv "$agent_dir/agent.env" PORT 2>/dev/null || true)"
    if [[ -n "$port" ]] && curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
        echo "→ $name still on port $port — killing by port"
        if kill_port_local "$port"; then
            stopped=1
        else
            echo "  ! Could not find lsof/ss/fuser to kill port $port." >&2
            echo "    Find the process manually:" >&2
            echo "      lsof -i :$port  |  ss -ltnp | grep :$port  |  fuser -v ${port}/tcp" >&2
        fi
    fi"""


def main() -> int:
    print(f"API root: {ROOT}")
    BACKUP.mkdir(parents=True, exist_ok=True)

    print()
    print("--- patches ---")
    if patch(COMMON, [(COMMON_ANCHOR, COMMON_INSERT + COMMON_ANCHOR)]) < 0:
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 2
    if patch(STOP, [(STOP_OLD, STOP_NEW)]) < 0:
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 2

    print()
    print("=== syntax ===")
    ok = True
    ok &= bash_n(COMMON)
    ok &= bash_n(STOP)
    ok &= shellcheck(COMMON)
    ok &= shellcheck(STOP)
    if not ok:
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 3

    print()
    print("=== smoke test ===")
    if not smoke_kill_port_local():
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 4

    print()
    print("=== Commit ===")
    git_commit("step42: kill-by-port fallback without npx")

    print()
    print(f"Done. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
    return 0


if __name__ == "__main__":
    sys.exit(main())