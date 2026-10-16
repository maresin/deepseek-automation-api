#!/usr/bin/env python3
"""
Step 45: sync read_kv between common.sh and demo_client.py.

Both parsers read the same agent.env. Small divergences cause one
side to see a value the other side misses.

Differences before this step:
  - common.sh  : no leading-whitespace strip before matching.
  - demo_client: strips the whole line, so "  KEY=value" matches.

Result: an agent.env with an indented key parses in Python but not
in Bash. For generated files this never triggers; for hand-edited
ones it silently breaks.

Fix: common.sh now strips leading whitespace and skips comment
lines explicitly, matching Python's behaviour. Neither parser
strips quotes from values, and both handle CRLF.

Behaviour after this step (per both implementations):
  - line is stripped of trailing \\r,
  - leading whitespace is removed before matching,
  - empty lines and lines starting with # are skipped,
  - KEY=value matches exactly (no space before =),
  - value is trimmed of surrounding whitespace,
  - surrounding quotes are preserved.

Gate:
  - bash -n common.sh,
  - python3 -m py_compile demo_client.py,
  - smoke test: a fixture env file with the edge cases above, run
    through both parsers, outputs compared.

Rollback: cp -r .backup/dev-snapshot-v6/* .
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
BACKUP = ROOT / ".backup" / "dev-snapshot-v6"
COMMON = "tools/templates/lib/common.sh"
DEMO = "examples/two-agent-pipeline/demo_client.py"


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


def bash_n(rel: str) -> bool:
    print(f"  bash -n {rel}")
    r = run(["bash", "-n", str(ROOT / rel)], capture=True)
    if r.returncode != 0:
        print(f"    x {r.stderr.strip()[:200]}")
        return False
    return True


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
# Patch: common.sh read_kv
# ---------------------------------------------------------------------------

READKV_OLD = """read_kv() {
    local file="$1" key="$2" line
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\\r'}"
        case "$line" in
            "$key"=*)
                printf '%s' "${line#*=}" \\
                    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
                return 0
                ;;
        esac
    done < "$file"
    return 1
}"""

READKV_NEW = """read_kv() {
    # Parser contract, kept in sync with read_kv() in
    # examples/two-agent-pipeline/demo_client.py:
    #   - trailing \\r removed (CRLF tolerant),
    #   - leading whitespace removed before matching,
    #   - empty lines and comment lines (leading #) skipped,
    #   - KEY=value matches exactly; no space before =,
    #   - value trimmed of surrounding whitespace,
    #   - surrounding quotes preserved.
    local file="$1" key="$2" line
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\\r'}"
        line="${line#"${line%%[![:space:]]*}"}"
        [[ -z "$line" ]] && continue
        [[ "$line" == \\#* ]] && continue
        case "$line" in
            "$key"=*)
                printf '%s' "${line#*=}" \\
                    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
                return 0
                ;;
        esac
    done < "$file"
    return 1
}"""


# ---------------------------------------------------------------------------
# Smoke test: compare both parsers on a fixture
# ---------------------------------------------------------------------------

FIXTURE_NORMAL = (
    "# leading comment\n"
    "\n"
    "PORT=3000\n"
    "  INDENTED=yes\n"
    "TRAILING=value   \n"
    'QUOTED="has quotes"\n'
    "  # indented comment\n"
    "KEY_WITH_EQ=a=b=c\n"
)

FIXTURE_CRLF = (
    "# crlf fixture\r\n"
    "PORT=3001\r\n"
    "  INDENTED=yes-crlf\r\n"
)

KEYS = [
    "PORT",
    "INDENTED",
    "TRAILING",
    "QUOTED",
    "KEY_WITH_EQ",
]

SHELL_READER = (
    "set -euo pipefail\n"
    'source "{common}"\n'
    "read_kv \"$1\" \"$2\"\n"
)

PY_READER = r'''
import importlib.util
import sys
from pathlib import Path

target = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("demo_client", target)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

value = mod.read_kv(Path(sys.argv[2]), sys.argv[3])
sys.stdout.write(value)
'''


def read_via_shell(fixture: Path, key: str) -> tuple:
    with tempfile.NamedTemporaryFile("w", suffix=".sh",
                                     delete=False) as f:
        f.write(SHELL_READER.format(common=str(ROOT / COMMON)))
        script = f.name
    try:
        r = subprocess.run(
            ["bash", script, str(fixture), key],
            capture_output=True, text=True,
        )
        return r.returncode, r.stdout
    finally:
        os.unlink(script)


def read_via_python(fixture: Path, key: str) -> tuple:
    with tempfile.NamedTemporaryFile("w", suffix=".py",
                                     delete=False) as f:
        f.write(PY_READER)
        script = f.name
    try:
        r = subprocess.run(
            ["python3", script, str(ROOT / DEMO), str(fixture), key],
            capture_output=True, text=True,
        )
        return r.returncode, r.stdout
    finally:
        os.unlink(script)


def compare_on_fixture(label: str, content: str) -> bool:
    print(f"  - {label}")
    with tempfile.NamedTemporaryFile("w", suffix=".env",
                                     delete=False, newline="") as f:
        f.write(content)
        fixture = Path(f.name)

    try:
        ok = True
        for key in KEYS:
            rc_sh, out_sh = read_via_shell(fixture, key)
            rc_py, out_py = read_via_python(fixture, key)

            if rc_sh != 0 and rc_py != 0:
                # Both miss the key — consistent.
                continue
            if rc_sh != 0 or rc_py != 0:
                print(f"    x {key}: shell rc={rc_sh} {out_sh!r} | "
                      f"python rc={rc_py} {out_py!r}")
                ok = False
                continue
            if out_sh != out_py:
                print(f"    x {key}: shell={out_sh!r} python={out_py!r}")
                ok = False
        return ok
    finally:
        fixture.unlink()


def smoke_parsers_agree() -> bool:
    ok = True
    ok &= compare_on_fixture("LF fixture", FIXTURE_NORMAL)
    ok &= compare_on_fixture("CRLF fixture", FIXTURE_CRLF)
    return ok


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print(f"API root: {ROOT}")
    BACKUP.mkdir(parents=True, exist_ok=True)

    print()
    print("--- patch ---")
    if patch(COMMON, [(READKV_OLD, READKV_NEW)]) < 0:
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 2

    print()
    print("=== syntax ===")
    ok = bash_n(COMMON) and py_compile(DEMO)
    if not ok:
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 3

    print()
    print("=== smoke test ===")
    if not smoke_parsers_agree():
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 4

    print()
    print("=== Commit ===")
    git_commit("step45: sync read_kv between common.sh and demo_client.py")

    print()
    print(f"Done. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
    return 0


if __name__ == "__main__":
    sys.exit(main())