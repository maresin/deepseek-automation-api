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
    local file="$1" key="$2" line
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
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