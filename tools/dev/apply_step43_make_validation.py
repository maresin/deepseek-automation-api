#!/usr/bin/env python3
"""
Step 43: validate arguments in make-multi-agent.sh.

Three failure modes are fixed, all from missing input validation:

  - --subdir accepts '.', '..', absolute paths, and paths containing
    '..'. With --force the script does `rm -rf "$TARGET/$SUBDIR"`,
    which can delete files outside the target directory
    (--subdir ../../etc, --subdir ., etc.).

  - --agents accepts arbitrary strings and unbounded integers. Each
    agent is a separate Chromium (~300 MB); --agents 100 is 30 GB of
    RAM. Non-numeric values fall through to `seq` and abort with an
    unhelpful error from seq, not from this script.

  - --base-port accepts values that do not fit in the 16-bit range,
    or a (base + agents - 1) combination that overflows 65535. The
    resulting agent.env gets an invalid PORT, and Node fails to bind
    with a generic error.

Validation runs after TARGET is known (needed for the range check on
--base-port) and before any filesystem work, so bad input fails fast
and cleanly.

Gate:
  - bash -n on the patched file (syntax),
  - shellcheck if installed (style, optional),
  - four smoke tests using mktemp -d and a sentinel file: they must
    exit non-zero and must NOT delete the target.

Rollback: cp -r .backup/dev-snapshot-v1/* .

Run from anywhere:
    python3 tools/dev/apply_step43_make_validation.py
or
    API_ROOT=/path/to/api python3 apply_step43_make_validation.py
or
    python3 apply_step43_make_validation.py /path/to/api
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
BACKUP = ROOT / ".backup" / "dev-snapshot-v1"
TARGET_FILE = "tools/make-multi-agent.sh"


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
                print(f"  = {rel}: already patched")
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
        print(f"  + {rel}: applied ({old[:60]!r})")

    if text != original:
        backup(rel)
        p.write_text(text, encoding="utf-8")
    return total


def run(cmd: list, cwd: Path = ROOT, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=cwd, capture_output=capture, text=True
    )


def check_syntax(rel: str) -> bool:
    print()
    print(f"=== bash -n {rel} ===")
    r = run(["bash", "-n", str(ROOT / rel)])
    if r.returncode != 0:
        print(f"  x syntax error")
        return False
    print("  + ok")
    return True


def check_shellcheck(rel: str) -> bool:
    if shutil.which("shellcheck") is None:
        print()
        print("=== shellcheck (skipped, not installed) ===")
        return True
    print()
    print(f"=== shellcheck {rel} ===")
    r = run(["shellcheck", "--severity=error", str(ROOT / rel)])
    if r.returncode != 0:
        print(f"  x shellcheck found errors")
        return False
    print("  + ok")
    return True


def smoke_test(args: list, expect_substr: str, label: str) -> bool:
    """
    Run make-multi-agent.sh with the given args against a fresh mktemp
    target containing a sentinel file. Assert exit != 0 and message
    contains expect_substr. Assert the sentinel survived — a
    validation failure must abort before any rm -rf.
    """
    print(f"  - {label}")
    with tempfile.TemporaryDirectory(prefix="step43-smoke-") as t:
        tgt = Path(t)
        sentinel = tgt / "sentinel"
        sentinel.write_text("intact")

        r = run(
            ["bash", str(ROOT / TARGET_FILE), str(tgt)] + args,
            capture=True
        )

        if r.returncode == 0:
            print(f"    x expected non-zero exit, got 0")
            return False

        combined = (r.stdout or "") + (r.stderr or "")
        if expect_substr not in combined:
            print(f"    x expected message containing {expect_substr!r}")
            print(f"      got: {combined[:300]!r}")
            return False

        if not sentinel.exists():
            print(f"    x sentinel deleted - validation ran AFTER rm -rf")
            return False

    return True


def run_smoke_tests() -> bool:
    print()
    print("=== smoke tests ===")
    ok = True
    ok &= smoke_test(
        ["--subdir", ".", "--force"],
        "must be a non-empty path",
        "--subdir . rejected"
    )
    ok &= smoke_test(
        ["--subdir", "../../etc", "--force"],
        "must not contain '..'",
        "--subdir ../../etc rejected"
    )
    ok &= smoke_test(
        ["--agents", "100"],
        "between 1 and 32",
        "--agents 100 rejected"
    )
    ok &= smoke_test(
        ["--base-port", "65535", "--agents", "2"],
        "must fit in 1024..65535",
        "--base-port 65535 --agents 2 rejected"
    )
    ok &= smoke_test(
        ["--restore", "maybe"],
        "must be 'true' or 'false'",
        "--restore maybe rejected"
    )
    if not ok:
        print("  x one or more smoke tests failed")
    return bool(ok)


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
# Patch
# ---------------------------------------------------------------------------

ANCHOR_OLD = """if [[ -z "$TARGET" ]]; then
    usage >&2
    exit 1
fi

# --------------------------------------------------------------------
# sanity checks
# --------------------------------------------------------------------"""

ANCHOR_NEW = """if [[ -z "$TARGET" ]]; then
    usage >&2
    exit 1
fi

# --------------------------------------------------------------------
# input validation
# --------------------------------------------------------------------

validate_args() {
    # --subdir: relative, no '..', not '.' or '..', not empty.
    # With --force the script does `rm -rf "$TARGET/$SUBDIR"`, so a
    # bad value here is a data-loss bug, not a warning.
    if [[ -z "$SUBDIR" || "$SUBDIR" == "." || "$SUBDIR" == ".." ]]; then
        echo "✗ --subdir must be a non-empty path other than '.' or '..'" >&2
        echo "  Got: ${SUBDIR:-(empty)}" >&2
        exit 1
    fi
    if [[ "$SUBDIR" == /* ]]; then
        echo "✗ --subdir must be relative, not absolute" >&2
        echo "  Got: $SUBDIR" >&2
        exit 1
    fi
    if [[ "$SUBDIR" == *..* ]]; then
        echo "✗ --subdir must not contain '..'" >&2
        echo "  Got: $SUBDIR" >&2
        exit 1
    fi

    # --agents: 1..32. Each agent is a separate Chromium (~300 MB).
    if ! [[ "$AGENTS" =~ ^[0-9]+$ ]] || (( AGENTS < 1 || AGENTS > 32 )); then
        echo "✗ --agents must be an integer between 1 and 32" >&2
        echo "  Got: $AGENTS" >&2
        exit 1
    fi

    # --base-port: 1024..65535, and the whole range must fit.
    if ! [[ "$BASE_PORT" =~ ^[0-9]+$ ]]; then
        echo "✗ --base-port must be an integer" >&2
        echo "  Got: $BASE_PORT" >&2
        exit 1
    fi
    local last_port=$(( BASE_PORT + AGENTS - 1 ))
    if (( BASE_PORT < 1024 || last_port > 65535 )); then
        echo "✗ --base-port range must fit in 1024..65535" >&2
        echo "  Got range: $BASE_PORT..$last_port" >&2
        exit 1
    fi

    # Boolean flags.
    if [[ "$RESTORE" != "true" && "$RESTORE" != "false" ]]; then
        echo "✗ --restore must be 'true' or 'false'" >&2
        echo "  Got: $RESTORE" >&2
        exit 1
    fi
    if [[ "$SNAPSHOT" != "true" && "$SNAPSHOT" != "false" ]]; then
        echo "✗ --snapshot must be 'true' or 'false'" >&2
        echo "  Got: $SNAPSHOT" >&2
        exit 1
    fi
    if [[ "$RAG" != "true" && "$RAG" != "false" ]]; then
        echo "✗ --rag must be 'true' or 'false'" >&2
        echo "  Got: $RAG" >&2
        exit 1
    fi
}

validate_args

# --------------------------------------------------------------------
# sanity checks
# --------------------------------------------------------------------"""


def main() -> int:
    print(f"API root: {ROOT}")
    BACKUP.mkdir(parents=True, exist_ok=True)

    print()
    print(f"--- {TARGET_FILE} ---")
    if patch(TARGET_FILE, [(ANCHOR_OLD, ANCHOR_NEW)]) < 0:
        print()
        print(f"Aborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 2

    if not check_syntax(TARGET_FILE):
        print()
        print(f"Aborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 3

    if not check_shellcheck(TARGET_FILE):
        print()
        print(f"Aborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 3

    if not run_smoke_tests():
        print()
        print(f"Aborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 4

    print()
    print("=== Commit ===")
    git_commit("step43: validate --subdir/--agents/--base-port/--restore "
               "in make-multi-agent.sh")

    print()
    print(f"Done. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
    return 0


if __name__ == "__main__":
    sys.exit(main())