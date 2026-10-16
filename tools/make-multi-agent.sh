#!/usr/bin/env bash
#
# make-multi-agent.sh — build a multi-agent deployment directory.
#
# Usage:
#     ./tools/make-multi-agent.sh <target-dir> [options]
#
# The <target-dir> is the user's project root. A subdirectory named
# "deepseek-agents" (overridable with --subdir) is created inside it.
# All generated files live under that subdirectory; the project root
# is left untouched apart from that one subfolder.
#
# Prerequisite: the API must have been started at least once and a
# state.json must exist in the API root. This file is the DeepSeek
# cookie session, established through a normal (non-automated) login.
#
# Example:
#     cd deepseek-automation-api
#     ./tools/make-multi-agent.sh ~/my-project --agents 3 --base-port 3010

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES="$SCRIPT_DIR/templates"

# --------------------------------------------------------------------
# defaults
# --------------------------------------------------------------------

AGENTS=2
BASE_PORT=3000
RESTORE=true
SNAPSHOT=true
RAG=true
SUBDIR="deepseek-agents"
FORCE=false
UPDATE_STATE=false
TARGET=""

usage() {
    cat <<'EOF'
make-multi-agent.sh — build a multi-agent deployment directory

Usage:
    ./tools/make-multi-agent.sh <target-dir> [options]

The <target-dir> is the user's project root. A subdirectory named
"deepseek-agents" (overridable with --subdir) is created inside it.

Options:
    --agents N          number of agents (default: 2)
    --base-port P       port of the first agent (default: 3000)
    --restore BOOL      ENABLE_RESTORE  (default: true)
    --snapshot BOOL     ENABLE_SNAPSHOT (default: true)
    --rag BOOL          ENABLE_RAG      (default: true)
    --subdir NAME       name of the generated subdirectory
                        (default: deepseek-agents)
    --force             overwrite an existing subdirectory
    --update-state      only refresh shared-state.json in an
                        existing deployment; do not touch anything else
    -h, --help          show this help and exit

Examples:
    ./tools/make-multi-agent.sh ~/project
    ./tools/make-multi-agent.sh ~/project --agents 3 --base-port 3010
    ./tools/make-multi-agent.sh ~/project --update-state

EOF
}

# --------------------------------------------------------------------
# argument parsing
# --------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --agents)       AGENTS="$2"; shift 2 ;;
        --base-port)    BASE_PORT="$2"; shift 2 ;;
        --restore)      RESTORE="$2"; shift 2 ;;
        --snapshot)     SNAPSHOT="$2"; shift 2 ;;
        --rag)          RAG="$2"; shift 2 ;;
        --subdir)       SUBDIR="$2"; shift 2 ;;
        --force)        FORCE=true; shift ;;
        --update-state) UPDATE_STATE=true; shift ;;
        -h|--help)      usage; exit 0 ;;
        -*)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            if [[ -z "$TARGET" ]]; then
                TARGET="$1"
            else
                echo "Unexpected argument: $1" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$TARGET" ]]; then
    usage >&2
    exit 1
fi

# --------------------------------------------------------------------
# input validation
# --------------------------------------------------------------------

validate_args() {
    # --subdir: relative, no '..', not '.' or '..', not empty.
    # With --force the script does `rm -rf "$TARGET/$SUBDIR"`, so a
    # bad value here is a data-loss bug, not a warning.
    if [[ -z "$SUBDIR" || "$SUBDIR" == "." || "$SUBDIR" == ".." ]]; then
        echo "✗ --subdir must be a non-empty path other than '.' or '..'" >&2
        echo "  Got: ${SUBDIR:-(empty)}" >&2
        exit 1
    fi
    if [[ "$SUBDIR" == /* ]]; then
        echo "✗ --subdir must be relative, not absolute" >&2
        echo "  Got: $SUBDIR" >&2
        exit 1
    fi
    if [[ "$SUBDIR" == *..* ]]; then
        echo "✗ --subdir must not contain '..'" >&2
        echo "  Got: $SUBDIR" >&2
        exit 1
    fi

    # --agents: 1..32. Each agent is a separate Chromium (~300 MB).
    if ! [[ "$AGENTS" =~ ^[0-9]+$ ]] || (( AGENTS < 1 || AGENTS > 32 )); then
        echo "✗ --agents must be an integer between 1 and 32" >&2
        echo "  Got: $AGENTS" >&2
        exit 1
    fi

    # --base-port: 1024..65535, and the whole range must fit.
    if ! [[ "$BASE_PORT" =~ ^[0-9]+$ ]]; then
        echo "✗ --base-port must be an integer" >&2
        echo "  Got: $BASE_PORT" >&2
        exit 1
    fi
    local last_port=$(( BASE_PORT + AGENTS - 1 ))
    if (( BASE_PORT < 1024 || last_port > 65535 )); then
        echo "✗ --base-port range must fit in 1024..65535" >&2
        echo "  Got range: $BASE_PORT..$last_port" >&2
        exit 1
    fi

    # Boolean flags.
    if [[ "$RESTORE" != "true" && "$RESTORE" != "false" ]]; then
        echo "✗ --restore must be 'true' or 'false'" >&2
        echo "  Got: $RESTORE" >&2
        exit 1
    fi
    if [[ "$SNAPSHOT" != "true" && "$SNAPSHOT" != "false" ]]; then
        echo "✗ --snapshot must be 'true' or 'false'" >&2
        echo "  Got: $SNAPSHOT" >&2
        exit 1
    fi
    if [[ "$RAG" != "true" && "$RAG" != "false" ]]; then
        echo "✗ --rag must be 'true' or 'false'" >&2
        echo "  Got: $RAG" >&2
        exit 1
    fi
}

validate_args

# --------------------------------------------------------------------
# sanity checks
# --------------------------------------------------------------------

API_STATE="$API_ROOT/state.json"
if [[ ! -f "$API_STATE" ]]; then
    echo "✗ No $API_STATE found." >&2
    echo "  Start the API once and log in:" >&2
    echo "      cd $API_ROOT && npm start" >&2
    echo "  Then Ctrl+C and re-run this script." >&2
    exit 1
fi

if [[ ! -d "$TEMPLATES" ]]; then
    echo "✗ Templates directory missing: $TEMPLATES" >&2
    exit 1
fi

if [[ ! -d "$TARGET" ]]; then
    mkdir -p "$TARGET"
fi
TARGET="$(cd "$TARGET" && pwd)"
AGENT_ROOT="$TARGET/$SUBDIR"

# --------------------------------------------------------------------
# --update-state mode: refresh cookies only
# --------------------------------------------------------------------

if $UPDATE_STATE; then
    if [[ ! -d "$AGENT_ROOT" ]]; then
        echo "✗ $AGENT_ROOT does not exist." >&2
        echo "  Build the deployment first (without --update-state)." >&2
        exit 1
    fi

    cp "$API_STATE" "$AGENT_ROOT/shared-state.json"
    chmod 600 "$AGENT_ROOT/shared-state.json"
    echo "✓ Refreshed $AGENT_ROOT/shared-state.json"
    echo "  Restart the agents: cd $AGENT_ROOT && ./scripts/start-all.sh"
    exit 0
fi

# --------------------------------------------------------------------
# normal build mode
# --------------------------------------------------------------------

if [[ -e "$AGENT_ROOT" ]] && ! $FORCE; then
    echo "✗ $AGENT_ROOT already exists." >&2
    echo "  Use --force to overwrite, or --update-state to refresh cookies only." >&2
    exit 1
fi

if $FORCE && [[ -e "$AGENT_ROOT" ]]; then
    rm -rf "$AGENT_ROOT"
fi

mkdir -p "$AGENT_ROOT/scripts/lib" "$AGENT_ROOT/agents"

cp "$API_STATE" "$AGENT_ROOT/shared-state.json"
chmod 600 "$AGENT_ROOT/shared-state.json"

echo "$API_ROOT" > "$AGENT_ROOT/api-path.txt"

cp "$TEMPLATES/start-all.sh"      "$AGENT_ROOT/scripts/start-all.sh"
cp "$TEMPLATES/stop-all.sh"       "$AGENT_ROOT/scripts/stop-all.sh"
cp "$TEMPLATES/status.sh"         "$AGENT_ROOT/scripts/status.sh"
cp "$TEMPLATES/refresh-state.sh"  "$AGENT_ROOT/scripts/refresh-state.sh"
cp "$TEMPLATES/lib/common.sh"     "$AGENT_ROOT/scripts/lib/common.sh"
chmod +x "$AGENT_ROOT/scripts/"*.sh

cp "$TEMPLATES/.gitignore" "$AGENT_ROOT/.gitignore"

# --------------------------------------------------------------------
# generate one directory per agent
# --------------------------------------------------------------------

# Build three parallel representations of the per-agent data:
#   - the agent directories on disk
#   - KEY_TABLE: markdown rows for the README
#   - STDOUT_TABLE: aligned plain text for the terminal summary
KEY_TABLE=""
STDOUT_TABLE=""

for i in $(seq 1 "$AGENTS"); do
    name="agent-$i"
    port=$(( BASE_PORT + i - 1 ))

    if command -v openssl >/dev/null 2>&1; then
        suffix="$(openssl rand -hex 8)"
    else
        suffix="$(printf '%04x%04x%04x%04x' $RANDOM $RANDOM $RANDOM $RANDOM)"
    fi
    key="deepseek_${name}_${suffix}"

    agent_dir="$AGENT_ROOT/agents/$name"
    mkdir -p "$agent_dir"

    cat > "$agent_dir/agent.env" <<EOF
# $name — generated by make-multi-agent.sh
#
# Paths are relative to this directory. The server is started from
# here, so ./\${VAR} resolves to per-agent data and ../../shared-state.json
# resolves to the shared cookie session.

PORT=$port

# Shared DeepSeek cookie session — same file for every agent.
DEEPSEEK_STATE_PATH=../../shared-state.json

# Per-agent isolated state.
DEEPSEEK_CHAT_STATE_PATH=./chat_state.json
DEEPSEEK_API_KEY_PATH=./.api-key
DEEPSEEK_UPLOAD_DIR=./uploads
RAG_DATA_DIR=./rag_data

# Feature flags.
DEEPSEEK_HEADLESS=true
ENABLE_RESTORE=$RESTORE
ENABLE_SNAPSHOT=$SNAPSHOT
ENABLE_RAG=$RAG
EOF

    echo "$key" > "$agent_dir/.api-key"
    chmod 600 "$agent_dir/.api-key"

    KEY_TABLE+="| $name | $port | \`$key\` |"$'\n'
    STDOUT_TABLE+="$(printf '    %-10s port %-5s %s' "$name" "$port" "$key")"$'\n'
done

# --------------------------------------------------------------------
# generate README.md — deployment-specific only
# --------------------------------------------------------------------
#
# This README is intentionally short. It contains only what is
# unique to this deployment: the agent names, ports, and API keys.
# Everything else (registration, captcha, RAG, troubleshooting) lives
# in the API repository documentation, which is referenced below.

GENERATED_AT="$(date -u '+%Y-%m-%d %H:%M UTC')"

cat > "$AGENT_ROOT/README.md" <<EOF
# DeepSeek agents

Generated on $GENERATED_AT. $AGENTS agents sharing one DeepSeek session.

## Agents

| Agent | Port | API key |
|-------|------|---------|
$KEY_TABLE
## Commands

    ./scripts/start-all.sh      start all agents
    ./scripts/status.sh         show status and context usage
    ./scripts/stop-all.sh       stop all agents
    ./scripts/refresh-state.sh  re-copy cookies after a fresh login

## Example request

    curl -X POST http://localhost:$BASE_PORT/v1/chat/completions \\
      -H "Authorization: Bearer <key from the table above>" \\
      -H "Content-Type: application/json" \\
      -d '{"messages":[{"role":"user","content":"Hello"}]}'

## If the cookies expire

Symptoms: \`Performing auto-login\` or \`Chat page did not load\` in
\`agents/<name>/agent.log\`.

    # 1. Log in again in the API directory
    cd $API_ROOT && npm start
    # ... complete the browser login, then Ctrl+C

    # 2. Copy the fresh cookies
    ./scripts/refresh-state.sh

    # 3. Restart
    ./scripts/start-all.sh

If the DeepSeek login itself fails (captcha loop, deleted account,
etc.), see the registration recipes in the API documentation:

    $API_ROOT/docs/guides/troubleshooting.md

## Full documentation

    $API_ROOT/README.md
    $API_ROOT/docs/guides/building-applications.md
EOF

# --------------------------------------------------------------------
# done
# --------------------------------------------------------------------

echo ""
echo "✓ Generated $AGENT_ROOT"
echo "  Agents:  $AGENTS"
echo "  Ports:   $BASE_PORT..$(( BASE_PORT + AGENTS - 1 ))"
echo ""
echo "  Agent keys (also in README.md):"
echo "$STDOUT_TABLE"
echo "Next:"
echo "    cd $AGENT_ROOT"
echo "    ./scripts/start-all.sh"