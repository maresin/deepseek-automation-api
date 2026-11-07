#!/usr/bin/env bash
#
# start-all.sh — start every agent defined under agents/.
#
# Each agent runs in its own directory with its own agent.env. The
# script waits for each to reach readiness (the DeepSeek client
# initialised), not merely for the HTTP port to open.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/common.sh"

API_PATH="$(api_path)"
if [[ ! -f "$API_PATH/server.js" ]]; then
    echo "✗ server.js not found at $API_PATH" >&2
    echo "  Update $ROOT/api-path.txt if the API moved." >&2
    exit 1
fi

# Refuse to start if any agent is already running.
# Force-stop any leftover agents from this deployment. A crashed or
# unclean shutdown must not block a restart. Foreign processes on an
# agent port are rejected, not killed.
if compgen -G "$ROOT/agents/*/agent.pid" > /dev/null; then
    for pidfile in "$ROOT"/agents/*/agent.pid; do
        [[ -f "$pidfile" ]] || continue
        pid="$(cat "$pidfile" 2>/dev/null || true)"
        if pid_is_live_agent "$pid"; then
            kill_pid_hard "$pid" "leftover agent (from $(basename "$pidfile"))"
        fi
        rm -f "$pidfile"
    done
fi

for agent_dir in "$ROOT"/agents/*/; do
    [[ -d "$agent_dir" ]] || continue
    port="$(read_kv "$agent_dir/agent.env" PORT 2>/dev/null || true)"
    [[ -n "$port" ]] || continue
    if ss -tln 2>/dev/null | grep -q ":$port "; then
        rc=0
        kill_agent_on_port "$port" "$(basename "$agent_dir")" || rc=$?
        [[ "$rc" -eq 2 ]] && exit 1
    fi
done

# Collect agent directories into an array.
dirs=()
while IFS= read -r d; do dirs+=("$d"); done < <(agent_dirs)

if [[ ${#dirs[@]} -eq 0 ]]; then
    echo "✗ No agents found under $ROOT/agents" >&2
    exit 1
fi

# Start each agent, staggered by 1 s. Staggering is not required for
# correctness (the mtime-guard handles races on shared-state.json)
# but it keeps the logs readable.
for agent_dir in "${dirs[@]}"; do
    name="$(basename "$agent_dir")"
    (
        cd "$agent_dir"
        load_env ./agent.env
        nohup node "$API_PATH/server.js" > agent.log 2>&1 &
        echo $! > agent.pid
    )
    echo "→ $name starting"
    sleep 1
done

# Wait for readiness.
fail=0
for agent_dir in "${dirs[@]}"; do
    name="$(basename "$agent_dir")"
    port="$(read_kv "$agent_dir/agent.env" PORT)"
    if ! wait_for_ready "$port" "$agent_dir/.api-key" "$name"; then
        echo "  → Last 20 lines of $name/agent.log:"
        tail -n 20 "$agent_dir/agent.log" 2>/dev/null || true
        fail=1
    fi
done

if [[ "$fail" -ne 0 ]]; then
    echo ""
    echo "Some agents failed to start. Check the logs and run stop-all.sh." >&2
    exit 1
fi

echo ""
echo "All ${#dirs[@]} agents ready."
for agent_dir in "${dirs[@]}"; do
    name="$(basename "$agent_dir")"
    port="$(read_kv "$agent_dir/agent.env" PORT)"
    printf "  %-10s http://127.0.0.1:%s\n" "$name" "$port"
done