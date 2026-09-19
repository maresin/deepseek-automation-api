#!/usr/bin/env bash
#
# Static syntax check for all examples.
# Does not require a running server.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILED=0

echo "=== Python syntax ==="
for f in "$DIR"/python/*.py; do
    if python3 -m py_compile "$f" 2>/tmp/lint_err; then
        echo "  ✓ $(basename "$f")"
    else
        echo "  ✗ $(basename "$f")"
        cat /tmp/lint_err
        FAILED=1
    fi
done

echo ""
echo "=== JavaScript syntax ==="
for f in "$DIR"/javascript/*.js; do
    if node --check "$f" 2>/tmp/lint_err; then
        echo "  ✓ $(basename "$f")"
    else
        echo "  ✗ $(basename "$f")"
        cat /tmp/lint_err
        FAILED=1
    fi
done

echo ""
echo "=== Bash syntax ==="
for f in "$DIR"/curl/*.sh; do
    if bash -n "$f" 2>/tmp/lint_err; then
        echo "  ✓ $(basename "$f")"
    else
        echo "  ✗ $(basename "$f")"
        cat /tmp/lint_err
        FAILED=1
    fi
done

rm -f /tmp/lint_err

echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "✓ All files pass syntax check."
else
    echo "✗ Some files failed. See errors above."
    exit 1
fi