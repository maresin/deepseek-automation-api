#!/usr/bin/env bash
#
# stop-all.sh — stop every agent. Uses PID files when present; falls
# back to killing whatever is listening on the agent's port.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/common.sh"

stopped=0

while IFS= read -r agent_dir; do
    name="$(basename "$agent_dir")"
    pidfile="$agent_dir/agent.pid"

    if [[ -f "$pidfile" ]]; then
        pid="$(cat "$pidfile" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            echo "→ Stopping $name (PID $pid)"
            kill "$pid" 2>/dev/null || true
            for _ in 1 2 3 4 5; do
                kill -0 "$pid" 2>/dev/null || break
                sleep 0.5
            done
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            stopped=1
        fi
        rm -f "$pidfile"
    fi

    # Fallback: is anything still on the port?
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
    fi
done < <(agent_dirs)

if [[ "$stopped" -eq 0 ]]; then
    echo "Nothing to stop."
else
    echo "Done."
fi