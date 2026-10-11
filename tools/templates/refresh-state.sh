#!/usr/bin/env bash
#
# refresh-state.sh — copy a fresh state.json from the API into
# shared-state.json.
#
# Use after logging in again (in the API) when the DeepSeek cookies
# have expired. Requires all agents to be stopped: otherwise their
# browsers may write a stale copy over the fresh one on shutdown.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/common.sh"

API_PATH="$(api_path)"
SRC="$API_PATH/state.json"

if [[ ! -f "$SRC" ]]; then
    echo "✗ $SRC not found." >&2
    echo "  Start the API once and log in:" >&2
    echo "      cd $API_PATH && npm start" >&2
    exit 1
fi

running=0
while IFS= read -r agent_dir; do
    pidfile="$agent_dir/agent.pid"
    [[ -f "$pidfile" ]] || continue
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        running=1
        echo "✗ $(basename "$agent_dir") is still running (PID $pid)" >&2
    fi
done < <(agent_dirs)

if [[ "$running" -ne 0 ]]; then
    echo "  Run $HERE/stop-all.sh first." >&2
    exit 1
fi

cp "$SRC" "$ROOT/shared-state.json"
chmod 600 "$ROOT/shared-state.json"
echo "✓ Copied fresh state from $SRC"
echo "  Restart the agents: $HERE/start-all.sh"