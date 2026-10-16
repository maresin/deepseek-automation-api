#!/usr/bin/env python3
"""
Step 44: filter cookies by domain in cookies-to-state.py.

The converter copies every cookie from the Cookie-Editor export
straight into state.json. Exports from a real browser session
typically include cookies for dozens of unrelated sites (Google,
GitHub, the user's bank). Playwright applies every cookie in the
state to every request the automation makes; unrelated cookies
are noise at best, an accidental leak at worst.

Fix: keep only cookies whose domain is, or is a subdomain of,
deepseek.com. Report skipped domains so the user can see what was
dropped and why.

ALLOWED_DOMAIN_SUFFIXES is a module-level tuple so it is easy to
extend if DeepSeek ever moves to a different domain.

Gate:
  - python3 -m py_compile,
  - smoke test: run the converter on a fixture with mixed domains
    and assert only deepseek.com cookies survive.

Rollback: cp -r .backup/dev-snapshot-v4/* .
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
BACKUP = ROOT / ".backup" / "dev-snapshot-v4"
TARGET = "tools/cookies-to-state.py"


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

CONST_OLD = """def convert(cookies_in: list) -> dict:
    cookies_out = []
    for c in cookies_in:
        if not c.get("name") or not c.get("value"):
            continue  # skip empty entries
        if not c.get("domain"):
            continue

        cookies_out.append({
            "name": c["name"],
            "value": c["value"],
            "domain": c["domain"],
            "path": c.get("path", "/"),
            "expires": c.get("expirationDate", -1),
            "httpOnly": bool(c.get("httpOnly", False)),
            "secure": bool(c.get("secure", True)),
            "sameSite": c.get("sameSite", "Lax"),
        })

    return {
        "cookies": cookies_out,
        "origins": [],
    }"""

CONST_NEW = '''# Only cookies whose domain is, or is a subdomain of, one of these
# suffixes are kept. A Cookie-Editor export typically contains
# cookies for dozens of unrelated sites; forwarding them all to
# Playwright injects them into every request the automation makes.
ALLOWED_DOMAIN_SUFFIXES: tuple = ("deepseek.com",)


def is_allowed_domain(domain: str) -> bool:
    d = domain.lstrip(".").lower()
    return any(d == s or d.endswith("." + s)
               for s in ALLOWED_DOMAIN_SUFFIXES)


def convert(cookies_in: list) -> tuple:
    """
    Return (state, skipped_domains).

    state is the Playwright storage-state dict; skipped_domains is a
    set of domain strings that were dropped because they do not
    match ALLOWED_DOMAIN_SUFFIXES.
    """
    cookies_out = []
    skipped_domains: set = set()

    for c in cookies_in:
        if not c.get("name") or not c.get("value"):
            continue  # skip empty entries
        if not c.get("domain"):
            continue
        if not is_allowed_domain(c["domain"]):
            skipped_domains.add(c["domain"])
            continue

        cookies_out.append({
            "name": c["name"],
            "value": c["value"],
            "domain": c["domain"],
            "path": c.get("path", "/"),
            "expires": c.get("expirationDate", -1),
            "httpOnly": bool(c.get("httpOnly", False)),
            "secure": bool(c.get("secure", True)),
            "sameSite": c.get("sameSite", "Lax"),
        })

    return (
        {"cookies": cookies_out, "origins": []},
        skipped_domains,
    )'''

MAIN_OLD = """    state = convert(raw)

    if not state["cookies"]:
        print("No usable cookies found in the input.", file=sys.stderr)
        return 1

    dst.write_text(json.dumps(state, indent=2), encoding="utf-8")"""

MAIN_NEW = """    state, skipped = convert(raw)

    if not state["cookies"]:
        print("No usable cookies found in the input.", file=sys.stderr)
        return 1

    if skipped:
        print(f"Skipped {len(skipped)} cookies for unrelated domains:")
        for d in sorted(skipped):
            print(f"  - {d}")
        print()

    dst.write_text(json.dumps(state, indent=2), encoding="utf-8")"""


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------

FIXTURE = [
    {"name": "cf_clearance", "value": "x", "domain": ".deepseek.com",
     "path": "/", "secure": True, "httpOnly": True},
    {"name": "session", "value": "y", "domain": "chat.deepseek.com",
     "path": "/", "secure": True, "httpOnly": True},
    {"name": "SID", "value": "z", "domain": ".google.com",
     "path": "/", "secure": True, "httpOnly": True},
    {"name": "token", "value": "w", "domain": "github.com",
     "path": "/", "secure": True, "httpOnly": False},
    {"name": "sid", "value": "v", "domain": "notdeepseek.com.evil",
     "path": "/", "secure": True, "httpOnly": True},
]


def smoke_domain_filter() -> bool:
    print("  - converter keeps deepseek.com, drops the rest")

    with tempfile.TemporaryDirectory(prefix="step44-") as t:
        tgt = Path(t)
        src = tgt / "in.json"
        out = tgt / "out.json"
        src.write_text(__import__("json").dumps(FIXTURE), encoding="utf-8")

        r = subprocess.run(
            ["python3", str(ROOT / TARGET), str(src), str(out)],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"    x converter exited {r.returncode}")
            print(f"      stderr: {r.stderr.strip()[:200]}")
            return False

        data = __import__("json").loads(out.read_text(encoding="utf-8"))
        names = sorted(c["name"] for c in data["cookies"])
        if names != ["cf_clearance", "session"]:
            print(f"    x expected [cf_clearance, session], got {names}")
            return False

        # Skipped domains should be reported on stdout.
        if "google.com" not in r.stdout:
            print(f"    x skipped domain 'google.com' not reported")
            print(f"      stdout: {r.stdout[:200]}")
            return False

        # The evil lookalike must not slip through.
        if "notdeepseek.com.evil" in r.stdout and "Skipped" not in r.stdout:
            print("    x lookalike domain not filtered")
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
    if patch(TARGET, [(CONST_OLD, CONST_NEW), (MAIN_OLD, MAIN_NEW)]) < 0:
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 2

    print()
    print("=== syntax ===")
    if not py_compile(TARGET):
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 3

    print()
    print("=== smoke test ===")
    if not smoke_domain_filter():
        print(f"\nAborting. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
        return 4

    print()
    print("=== Commit ===")
    git_commit("step44: filter cookies to deepseek.com in cookies-to-state.py")

    print()
    print(f"Done. Rollback: cp -r {BACKUP.relative_to(ROOT)}/* .")
    return 0


if __name__ == "__main__":
    sys.exit(main())