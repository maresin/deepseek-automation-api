#!/usr/bin/env bash
#
# common.sh — shared helpers for the generated start/stop/status
# scripts. Source from scripts/*.sh, never run directly.

# Project root: this file lives at ROOT/scripts/lib/common.sh.
_common_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$_common_dir/../.." && pwd)"
unset _common_dir

# Print the absolute path to the API, read from api-path.txt.
api_path() {
    local p="$ROOT/api-path.txt"
    if [[ ! -f "$p" ]]; then
        echo "✗ api-path.txt not found at $p" >&2
        return 1
    fi
    cat "$p"
}

# List agent directories, one per line, sorted. Prints nothing if the
# agents/ directory is empty or missing.
agent_dirs() {
    local dir="$ROOT/agents"
    [[ -d "$dir" ]] || return 0
    find "$dir" -mindepth 1 -maxdepth 1 -type d | sort
}

# Read a single KEY=value from an env file. Prints the trimmed value,
# or exits with status 1 if the key is absent.
read_kv() {
    # Parser contract, kept in sync with read_kv() in
    # examples/two-agent-pipeline/demo_client.py:
    #   - trailing \r removed (CRLF tolerant),
    #   - leading whitespace removed before matching,
    #   - empty lines and comment lines (leading #) skipped,
    #   - KEY=value matches exactly; no space before =,
    #   - value trimmed of surrounding whitespace,
    #   - surrounding quotes preserved.
    local file="$1" key="$2" line
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        line="${line#"${line%%[![:space:]]*}"}"
        [[ -z "$line" ]] && continue
        [[ "$line" == \#* ]] && continue
        case "$line" in
            "$key"=*)
                printf '%s' "${line#*=}" \
                    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
                return 0
                ;;
        esac
    done < "$file"
    return 1
}

# Export every KEY=value line from an env file into the current shell.
# Tolerates markdown code fences, CRLF endings, and comments with
# shell metacharacters.
load_env() {
    local file="$1" line key value
    [[ -f "$file" ]] || { echo "✗ env file not found: $file" >&2; return 1; }

    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        line="${line#"${line%%[![:space:]]*}"}"
        line="${line%"${line##*[![:space:]]}"}"
        [[ -z "$line" ]] && continue
        case "$line" in
            \#*|\`\`\`*) continue ;;
        esac
        case "$line" in
            *=*)
                key="${line%%=*}"
                value="${line#*=}"
                key="${key%"${key##*[![:space:]]}"}"
                key="${key#"${key%%[![:space:]]*}"}"
                value="${value#"${value%%[![:space:]]*}"}"
                value="${value%"${value##*[![:space:]]}"}"
                case "$value" in
                    \"*\") value="${value#\"}"; value="${value%\"}" ;;
                    \'*\') value="${value#\'}"; value="${value%\'}" ;;
                esac
                export "$key=$value"
                ;;
        esac
    done < "$file"
}

# Kill whatever process is listening on <port>, without npx and
# without network access. Tries lsof, then ss, then fuser. Returns 0
# if the port was occupied and the kill succeeded (or cannot be
# verified), 1 if the port was already free or no tool is available.
kill_port_local() {
    local port="$1"
    [[ -z "$port" ]] && return 1

    local pids

    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
        [[ -z "$pids" ]] && return 1
        echo "$pids" | xargs -r kill 2>/dev/null || true
        sleep 1
        pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
        if [[ -n "$pids" ]]; then
            echo "$pids" | xargs -r kill -9 2>/dev/null || true
        fi
        return 0
    fi

    if command -v ss >/dev/null 2>&1; then
        pids="$(ss -ltnp "sport = :${port}" 2>/dev/null \
            | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
        [[ -z "$pids" ]] && return 1
        echo "$pids" | xargs -r kill 2>/dev/null || true
        sleep 1
        pids="$(ss -ltnp "sport = :${port}" 2>/dev/null \
            | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
        if [[ -n "$pids" ]]; then
            echo "$pids" | xargs -r kill -9 2>/dev/null || true
        fi
        return 0
    fi

    if command -v fuser >/dev/null 2>&1; then
        fuser -k "${port}/tcp" >/dev/null 2>&1 || true
        return 0
    fi

    return 1
}

# Poll /v1/context/status until the given agent returns 200. This is
# the true readiness probe: /health only reports that the HTTP server
# is up, while the DeepSeek client takes 15–30 more seconds to
# initialise (Chromium launch, navigation, selector check).
#
#     wait_for_ready <port> <key-file> <label> [timeout-seconds]
wait_for_ready() {
    local port="$1" keyfile="$2" label="$3" timeout="${4:-180}"
    local deadline=$(( $(date +%s) + timeout ))
    local key code=""

    [[ -f "$keyfile" ]] || { echo "✗ key file not found: $keyfile" >&2; return 1; }
    key="$(cat "$keyfile")"

    printf "→ Waiting for %s (port %s)" "$label" "$port"
    while (( $(date +%s) < deadline )); do
        code=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "Authorization: Bearer $key" \
            "http://127.0.0.1:${port}/v1/context/status" 2>/dev/null || true)

        case "$code" in
            200) printf " ✓\n"; return 0 ;;
            401)
                printf " ✗\n"
                echo "  $label rejected its API key ($keyfile)" >&2
                return 1
                ;;
        esac
        printf "."
        sleep 1
    done

    printf " ✗\n"
    echo "  $label did not become ready in ${timeout}s (last code: $code)" >&2
    return 1
}

# ---------------------------------------------------------------
# Process lifecycle helpers
# ---------------------------------------------------------------

# Check if a PID corresponds to a live agent process.
# Rejects zombies (stat Z) and PIDs reused by unrelated processes.
pid_is_live_agent() {
    local pid="$1"
    [[ -n "$pid" ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    local state
    state=$(ps -p "$pid" -o stat= 2>/dev/null | tr -d ' ')
    case "$state" in
        Z*) return 1 ;;
    esac
    local cmd
    cmd=$(ps -p "$pid" -o cmd= 2>/dev/null || true)
    case "$cmd" in
        *server.js*) return 0 ;;
        *) return 1 ;;
    esac
}

# Kill a PID: SIGTERM, wait up to 5s, SIGKILL if still alive.
kill_pid_hard() {
    local pid="$1"
    local label="${2:-process}"
    [[ -n "$pid" ]] || return 0
    pid_is_live_agent "$pid" || return 0
    echo "→ Killing $label (PID $pid, SIGTERM)"
    kill -TERM "$pid" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        pid_is_live_agent "$pid" || return 0
        sleep 0.5
    done
    echo "  $label did not exit after SIGTERM, sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
    sleep 1
    if pid_is_live_agent "$pid"; then
        echo "  ⚠️ $label survived SIGKILL" >&2
        return 1
    fi
    return 0
}

# PID of the process listening on a TCP port, or empty.
port_holder_pid() {
    local port="$1"
    [[ -n "$port" ]] || return 1
    ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1
}

# Kill our agent process holding a port; refuse foreign processes.
# Return codes: 0 — nothing to do, 1 — killed, 2 — foreign, refuse.
kill_agent_on_port() {
    local port="$1"
    local label="${2:-agent}"
    [[ -n "$port" ]] || return 0
    ss -tln 2>/dev/null | grep -q ":$port " || return 0
    local holder
    holder="$(port_holder_pid "$port")"
    if [[ -z "$holder" ]]; then
        echo "  ⚠️ Port $port is bound but PID is not visible (root?)" >&2
        return 2
    fi
    if pid_is_live_agent "$holder"; then
        kill_pid_hard "$holder" "$label on port $port"
        return 1
    fi
    echo "✗ Port $port held by a foreign process (PID $holder)" >&2
    echo "  Refusing to kill. Stop it manually or change PORT." >&2
    return 2
}
