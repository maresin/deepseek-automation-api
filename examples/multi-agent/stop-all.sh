#!/usr/bin/env bash
#
# Stop both agents. Prefers the PID files written by start-all.sh;
# falls back to killing whatever is listening on the two ports.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

stop_by_pidfile() {
    local pidfile="$1"
    local label="$2"

    if [[ ! -f "$pidfile" ]]; then
        return 1
    fi

    local pid
    pid="$(cat "$pidfile")"
    if [[ -z "$pid" ]]; then
        rm -f "$pidfile"
        return 1
    fi

    if kill -0 "$pid" 2>/dev/null; then
        echo "→ Stopping $label (PID $pid)"
        kill "$pid" 2>/dev/null || true
        # Give it a moment to exit cleanly.
        for _ in 1 2 3 4 5; do
            if ! kill -0 "$pid" 2>/dev/null; then break; fi
            sleep 0.5
        done
        if kill -0 "$pid" 2>/dev/null; then
            echo "  $label did not exit cleanly, sending SIGKILL"
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
    rm -f "$pidfile"
    return 0
}

# ---- stop --------------------------------------------------------

stopped=0

if stop_by_pidfile "$HERE/agent-a.pid" "agent A"; then
    stopped=1
fi
if stop_by_pidfile "$HERE/agent-b.pid" "agent B"; then
    stopped=1
fi

# Fallback: kill anything still listening on the ports.
if command -v npx >/dev/null 2>&1; then
    if curl -sf http://localhost:3000/health >/dev/null 2>&1 \
    || curl -sf http://localhost:3001/health >/dev/null 2>&1; then
        echo "→ Ports still in use, running npx kill-port 3000 3001"
        npx --yes kill-port 3000 3001 >/dev/null 2>&1 || true
        stopped=1
    fi
fi

if [[ "$stopped" -eq 0 ]]; then
    echo "Nothing to stop."
else
    echo "Done."
fi