#!/usr/bin/env python3
"""
Step 46: use 127.0.0.1 instead of localhost in shell scripts and demo.

On macOS and some Linux distributions, 'localhost' resolves to ::1
(IPv6) before 127.0.0.1. Node, by default, binds to IPv4 only. The
symptom is a script that reports 'server not reachable' while the
server is demonstrably running and the port is listening.

Pingis already uses 127.0.0.1 everywhere. This step brings the API's
scripts and the two-agent demo to the same convention.

Files touched (paths under <api-root>):
  tools/templates/lib/common.sh      1 replacement
  tools/templates/status.sh          1 replacement
  tools/templates/stop-all.sh        1 replacement
  tools/templates/start-all.sh       1 replacement (print only)
  examples/two-agent-pipeline/demo_client.py   5 replacements

Gate:
  - bash -n on the four shell files,
  - python3 -m py_compile on demo_client.py,
  - grep for 'localhost' in the touched files: must be zero outside
    of comments/docstrings that intentionally mention the hostname.

Rollback: cp -r .backup/dev-snapshot-v2/* .

Run from anywhere:
    python3 tools/dev/apply_step46_loopback.py
"""

import os
import shutil
import subprocess
import sys
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
BACKUP = ROOT / ".backup" / "dev-snapshot-v2"

# Where each file is expected to live. If any is missing, the script
# aborts before touching anything — a partial commit here would be
# confusing.
EXPECTED = {
    "common":   "tools/templates/lib/common.sh",
    "status":   "tools/templates/status.sh",
    "stop":     "tools/templates/stop-all.sh",
    "start":    "tools/templates/start-all.sh",
    "demo":     "examples/two-agent-pipeline/demo_client.py",
}


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


def check_bash_syntax(rel: str) -> bool:
    print(f"  bash -n {rel}")
    r = subprocess.run(["bash", "-n", str(ROOT / rel)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f"    x {r.stderr.strip()[:200]}")
        return False
    return True


def check_py_syntax(rel: str) -> bool:
    print(f"  python3 -m py_compile {rel}")
    r = subprocess.run(
        ["python3", "-m", "py_compile", str(ROOT / rel)],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        print(f"    x {r.stderr.strip()[:200]}")
        return False
    return True


def check_no_bare_localhost(rel: str) -> bool:
    """
    Ensure no functional 'localhost' remains. Excludes comment lines
    (starting with # in .sh, or inside triple-quoted docstrings — for
    the demo, we allow 'localhost' only if it is on a line whose
    stripped form starts with '#' or is inside a docstring between
    triple quotes. Simplest check for the demo: 'http://localhost'
    and '(\"localhost\"' must be absent. Since we know every previous
    occurrence, grep for those exact tokens.)
    """
    p = ROOT / rel
    if not p.exists():
        return True
    text = p.read_text(encoding="utf-8")

    # Tokens that indicate a functional localhost URL or address.
    functional = ["http://localhost", "(\"localhost\"", "('localhost'"]
    hits = []
    for tok in functional:
        if tok in text:
            # count lines for reporting
            for i, line in enumerate(text.splitlines(), 1):
                if tok in line:
                    hits.append((i, line.strip()))

    if hits:
        print(f"    x {rel}: functional 'localhost' still present:")
        for ln, line in hits[:5]:
            print(f"      {ln}: {line[:100]}")
        return False
    return True


def run_cmd(cmd: list, label: str) -> bool:
    print()
    print(f"=== {label} ===")
    print("$ " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        print(f"  x {label} failed (exit {r.returncode})")
        return False
    print(f"  + {label} ok")
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

PATCHES = {
    "common": [
        (
            '"http://localhost:${port}/v1/context/status" 2>/dev/null || true)',
            '"http://127.0.0.1:${port}/v1/context/status" 2>/dev/null || true)',
        ),
    ],
    "status": [
        (
            '"http://localhost:$port/v1/context/status" 2>/dev/null || true)',
            '"http://127.0.0.1:$port/v1/context/status" 2>/dev/null || true)',
        ),
    ],
    "stop": [
        (
            'curl -sf "http://localhost:$port/health"',
            'curl -sf "http://127.0.0.1:$port/health"',
        ),
    ],
    "start": [
        (
            'printf "  %-10s http://localhost:%s\\n" "$name" "$port"',
            'printf "  %-10s http://127.0.0.1:%s\\n" "$name" "$port"',
        ),
    ],
    "demo": [
        (
            '"""Return True if a TCP connect to localhost:port succeeds quickly."""',
            '"""Return True if a TCP connect to 127.0.0.1:port succeeds quickly."""',
        ),
        (
            'with socket.create_connection(("localhost", port), timeout=timeout):',
            'with socket.create_connection(("127.0.0.1", port), timeout=timeout):',
        ),
        (
            'url = f"http://localhost:{port}/v1/context/status"',
            'url = f"http://127.0.0.1:{port}/v1/context/status"',
        ),
        (
            'url = f"http://localhost:{port}/v1/chat/completions"',
            'url = f"http://127.0.0.1:{port}/v1/chat/completions"',
        ),
        (
            'f"http://localhost:{port}/v1/chat/new",',
            'f"http://127.0.0.1:{port}/v1/chat/new",',
        ),
    ],
}


def main() -> int:
    print(f"API root: {ROOT}")

    print()
    print("=== preflight: check expected files ===")
    missing = []
    for key, rel in EXPECTED.items():
        if not (ROOT / rel).exists():
            missing.append(rel)
            print(f"  x {rel}: missing")
        else:
            print(f"  ✓ {rel}")
    if missing:
        print()
        print("Aborting: expected files not found. Adjust EXPECTED in this")
        print("script or run: find . -name common.sh -o -name demo_client.py")
        return 1

    BACKUP.mkdir(parents=True, exist_ok=True)

    print()
    print("=== patch ===")
    for key, rel in EXPECTED.items():
        print(f"--- {rel} ---")
        if patch(rel, PATCHES[key]) < 0:
            print()
            print(f"Aborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
            return 2

    print()
    print("=== syntax checks ===")
    ok = True
    for key in ("common", "status", "stop", "start"):
        ok &= check_bash_syntax(EXPECTED[key])
    ok &= check_py_syntax(EXPECTED["demo"])
    if not ok:
        print()
        print(f"Aborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 3

    print()
    print("=== no functional localhost ===")
    ok = True
    for key, rel in EXPECTED.items():
        ok &= check_no_bare_localhost(rel)
    if not ok:
        print()
        print(f"Aborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 4

    print()
    print("=== Commit ===")
    git_commit("step46: use 127.0.0.1 instead of localhost in scripts "
               "and demo")

    print()
    print(f"Done. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
    return 0


if __name__ == "__main__":
    sys.exit(main())