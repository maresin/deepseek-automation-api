#!/usr/bin/env bash
#
# Smoke-run 01_getting_started in all three languages.
# Requires: server running (npm start), prerequisites per language.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fresh session for each language — clean up any previous key.
rm -f "$DIR/python/.examples-api-key" \
      "$DIR/javascript/.examples-api-key" \
      "$DIR/curl/.examples-api-key"

echo "============================================================"
echo "Python"
echo "============================================================"
(cd "$DIR/python" && python3 01_getting_started.py)

echo ""
echo "============================================================"
echo "JavaScript"
echo "============================================================"
(cd "$DIR/javascript" && node 01_getting_started.js)

echo ""
echo "============================================================"
echo "cURL"
echo "============================================================"
(cd "$DIR/curl" && ./01_getting_started.sh)

echo ""
echo "✓ All smoke tests passed."