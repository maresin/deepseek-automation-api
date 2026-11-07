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
    pid=""
    [[ -f "$pidfile" ]] && pid="$(cat "$pidfile" 2>/dev/null || true)"

    if pid_is_live_agent "$pid"; then
        kill_pid_hard "$pid" "$name" || true
        stopped=1
    fi
    rm -f "$pidfile"

    # Port fallback: kill our agent process by port if the PID file
    # was missing, or the process survived despite the PID kill.
    port="$(read_kv "$agent_dir/agent.env" PORT 2>/dev/null || true)"
    if [[ -n "$port" ]] && ss -tln 2>/dev/null | grep -q ":$port "; then
        rc=0
        kill_agent_on_port "$port" "$name" || rc=$?
        [[ "$rc" -eq 1 ]] && stopped=1
        # rc=2 — foreign process on port; leave it, warn user
    fi
done < <(agent_dirs)

if [[ "$stopped" -eq 0 ]]; then
    echo "Nothing to stop."
else
    echo "Done."
fi
