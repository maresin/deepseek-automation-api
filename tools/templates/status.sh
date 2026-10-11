#!/usr/bin/env bash
#
# status.sh — show status of every agent: PID, port, context usage.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/common.sh"

printf "%-12s %-6s %-8s %-10s %s\n" "AGENT" "PORT" "PID" "STATE" "CONTEXT"
printf "%-12s %-6s %-8s %-10s %s\n" "-----" "----" "---" "-----" "-------"

while IFS= read -r agent_dir; do
    name="$(basename "$agent_dir")"
    port="$(read_kv "$agent_dir/agent.env" PORT 2>/dev/null || echo "?")"
    pidfile="$agent_dir/agent.pid"

    pid=""
    state="stopped"
    if [[ -f "$pidfile" ]]; then
        pid="$(cat "$pidfile" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            state="running"
        else
            state="dead"
        fi
    fi

    context=""
    if [[ "$state" == "running" ]] && [[ -f "$agent_dir/.api-key" ]]; then
        key="$(cat "$agent_dir/.api-key")"
        ctx=$(curl -s -H "Authorization: Bearer $key" \
            "http://localhost:$port/v1/context/status" 2>/dev/null || true)
        if [[ -n "$ctx" ]]; then
            used=$(printf '%s' "$ctx"  | grep -oE '"totalChars":[0-9]+' | cut -d: -f2 || true)
            limit=$(printf '%s' "$ctx" | grep -oE '"maxChars":[0-9]+'   | cut -d: -f2 || true)
            pct=$(printf '%s' "$ctx"   | grep -oE '"percent":[0-9]+'    | cut -d: -f2 || true)
            [[ -n "$used" ]] && context="${used}/${limit} (${pct}%)"
        fi
    fi

    printf "%-12s %-6s %-8s %-10s %s\n" \
        "$name" "$port" "${pid:--}" "$state" "$context"
done < <(agent_dirs)