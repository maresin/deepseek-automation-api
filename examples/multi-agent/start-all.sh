#!/usr/bin/env bash
#
# Start both agents in the background, wait for their CLIENT to be
# ready, write PID files. Runs on Linux, macOS, and Git Bash.
#
#     ./start-all.sh
#
# Run from this directory (examples/multi-agent/). The project root is
# resolved as two levels up.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/../.." && pwd)"

PORT_A=3000
PORT_B=3001
READY_TIMEOUT=180   # seconds; Chromium launch + navigation + selectors

# ---- sanity ---------------------------------------------------

for f in env.a.example env.b.example; do
    if [[ ! -f "$HERE/$f" ]]; then
        echo "✗ Missing $f" >&2
        exit 1
    fi
done

if [[ ! -f "$HERE/.env.a" ]]; then
    echo "→ Creating .env.a from env.a.example"
    cp "$HERE/env.a.example" "$HERE/.env.a"
fi

if [[ ! -f "$HERE/.env.b" ]]; then
    echo "→ Creating .env.b from env.b.example"
    cp "$HERE/env.b.example" "$HERE/.env.b"
fi

if [[ ! -f "$HERE/shared-state.json" ]]; then
    echo "✗ shared-state.json is missing." >&2
    echo "  Run cookies-to-state.py first, or copy a working state.json." >&2
    exit 1
fi

if [[ ! -f "$HERE/.api-key-a" ]]; then
    echo "→ Generating .api-key-a"
    echo "deepseek_agent_a_$(openssl rand -hex 8 2>/dev/null || date +%s%N)" \
        > "$HERE/.api-key-a"
    chmod 600 "$HERE/.api-key-a"
fi

if [[ ! -f "$HERE/.api-key-b" ]]; then
    echo "→ Generating .api-key-b"
    echo "deepseek_agent_b_$(openssl rand -hex 8 2>/dev/null || date +%s%N)" \
        > "$HERE/.api-key-b"
    chmod 600 "$HERE/.api-key-b"
fi

# ---- helper: load env file ------------------------------------
#
# Parses KEY=VALUE lines without invoking bash on the file. This
# survives three things that break a naive `source`:
#
#   1. Markdown code fences (```ini ... ```) that get copied along
#      with the file contents from documentation or chat.
#   2. Comment lines that contain shell metacharacters.
#   3. CRLF line endings from Windows-copied files.
#
# Values are exported into the current shell. Quoted values lose
# their quotes. Empty values are allowed (DEEPSEEK_EMAIL=).

load_env() {
    local file="$1"
    local line key value

    if [[ ! -f "$file" ]]; then
        echo "✗ load_env: file not found: $file" >&2
        return 1
    fi

    while IFS= read -r line || [[ -n "$line" ]]; do
        # Strip carriage return (CRLF)
        line="${line%$'\r'}"
        # Trim leading whitespace
        line="${line#"${line%%[![:space:]]*}"}"
        # Trim trailing whitespace
        line="${line%"${line##*[![:space:]]}"}"

        # Skip blank lines
        [[ -z "$line" ]] && continue

        # Skip comment lines and markdown code fences
        case "$line" in
            \#*)     continue ;;
            \`\`\`*) continue ;;
        esac

        # Only accept KEY=VALUE lines
        case "$line" in
            *=*)
                key="${line%%=*}"
                value="${line#*=}"

                # Trim whitespace around key
                key="${key%"${key##*[![:space:]]}"}"
                key="${key#"${key%%[![:space:]]*}"}"

                # Trim whitespace around value
                value="${value#"${value%%[![:space:]]*}"}"
                value="${value%"${value##*[![:space:]]}"}"

                # Strip surrounding quotes
                case "$value" in
                    \"*\") value="${value#\"}"; value="${value%\"}" ;;
                    \'*\') value="${value#\'}"; value="${value%\'}" ;;
                esac

                export "$key=$value"
                ;;
        esac
    done < "$file"
}

# ---- helper: wait for the CLIENT to be ready -------------------
#
# /health only checks that the HTTP server is listening, which happens
# seconds before the DeepSeek client is initialised. The client takes
# 15–30s to come up (Chromium launch + navigation + selector check).
# Sending a chat request before that returns 503 "Client not ready".
#
# /v1/context/status is the right readiness probe:
#   401 → wrong key (should not happen, we generated it)
#   503 → key is fine, but the client is not ready yet
#   200 → client is ready

wait_for_ready() {
    local port="$1"
    local keyfile="$2"
    local label="$3"
    local deadline=$(( $(date +%s) + READY_TIMEOUT ))
    local key
    key="$(cat "$keyfile")"

    printf "→ Waiting for %s to be ready (http://localhost:%s)" "$label" "$port"
    local code=""
    while (( $(date +%s) < deadline )); do
        code=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "Authorization: Bearer $key" \
            "http://localhost:${port}/v1/context/status" 2>/dev/null || true)

        case "$code" in
            200)
                printf " ✓\n"
                return 0
                ;;
            401)
                printf " ✗\n"
                echo "  $label rejected its API key — check $keyfile" >&2
                return 1
                ;;
        esac
        printf "."
        sleep 1
    done
    printf " ✗\n"
    echo "  $label did not become ready within ${READY_TIMEOUT}s (last code: $code)" >&2
    return 1
}

# ---- start agent A --------------------------------------------

echo "→ Starting agent A (PORT=$PORT_A)..."
(
    cd "$HERE"
    load_env .env.a
    # Override the port so agents never collide on the default.
    export PORT="$PORT_A"
    # Redirect logs and detach.
    nohup node "$PROJECT_ROOT/server.js" > "$HERE/agent-a.log" 2>&1 &
    echo $! > "$HERE/agent-a.pid"
)

# Give A a head start so its cookie write lands before B reads.
sleep 3

# ---- start agent B --------------------------------------------

echo "→ Starting agent B (PORT=$PORT_B)..."
(
    cd "$HERE"
    load_env .env.b
    export PORT="$PORT_B"
    nohup node "$PROJECT_ROOT/server.js" > "$HERE/agent-b.log" 2>&1 &
    echo $! > "$HERE/agent-b.pid"
)

# ---- wait for both --------------------------------------------

if ! wait_for_ready "$PORT_A" "$HERE/.api-key-a" "agent A"; then
    echo "  → Last 30 lines of agent-a.log:"
    tail -n 30 "$HERE/agent-a.log" 2>/dev/null || true
    exit 1
fi

if ! wait_for_ready "$PORT_B" "$HERE/.api-key-b" "agent B"; then
    echo "  → Last 30 lines of agent-b.log:"
    tail -n 30 "$HERE/agent-b.log" 2>/dev/null || true
    exit 1
fi

# ---- summary --------------------------------------------------

echo ""
echo "Both agents are running."
echo "  A: http://localhost:$PORT_A"
echo "  B: http://localhost:$PORT_B"
echo "Logs: $HERE/agent-a.log, $HERE/agent-b.log"
echo "Stop: $HERE/stop-all.sh"