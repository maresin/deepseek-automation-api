#!/usr/bin/env python3
"""
Convert Cookie-Editor JSON export → Playwright storageState.

Usage:
    python cookies-to-state.py cookies.json shared-state.json

The Cookie-Editor browser extension (Firefox / Chrome) exports cookies
as a flat JSON array with a slightly different field set than
Playwright expects. This script maps the fields and wraps the array in
the { "cookies": [...], "origins": [] } envelope that state.json uses.

Field mapping:
    Cookie-Editor          Playwright
    ─────────────────────  ──────────────────
    expirationDate         expires  (-1 for session cookies)
    sameSite               sameSite (defaults to "Lax" if absent)
    hostOnly               ignored  (Playwright infers from domain)
    session                ignored
    storeId                ignored

Run this on any machine that has the browser cookie export; the output
state.json can be copied to the automation host.
"""

import json
import sys
from pathlib import Path


# Only cookies whose domain is, or is a subdomain of, one of these
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
    )


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])

    if not src.exists():
        print(f"Input file not found: {src}", file=sys.stderr)
        return 1

    try:
        raw = json.loads(src.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"Invalid JSON in {src}: {e}", file=sys.stderr)
        return 1

    # Cookie-Editor sometimes wraps the array in {"cookies": [...]}.
    if isinstance(raw, dict) and "cookies" in raw:
        raw = raw["cookies"]

    if not isinstance(raw, list):
        print("Expected a JSON array of cookies", file=sys.stderr)
        return 1

    state, skipped = convert(raw)

    if not state["cookies"]:
        print("No usable cookies found in the input.", file=sys.stderr)
        return 1

    if skipped:
        print(f"Skipped {len(skipped)} cookies for unrelated domains:")
        for d in sorted(skipped):
            print(f"  - {d}")
        print()

    dst.write_text(json.dumps(state, indent=2), encoding="utf-8")
    dst.chmod(0o600)

    print(f"Wrote {len(state['cookies'])} cookies to {dst}")
    print("Cookie names:")
    for c in state["cookies"]:
        print(f"  - {c['name']}  (domain={c['domain']}, "
              f"secure={c['secure']}, httpOnly={c['httpOnly']})")

    if not any(c["name"] == "cf_clearance" for c in state["cookies"]):
        print(
            "\n⚠  cf_clearance cookie is missing. The automated browser "
            "may still need to solve a Cloudflare challenge.\n"
            "   Log in to chat.deepseek.com in a normal browser first, "
            "wait for the chat UI to load, then export again.",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())