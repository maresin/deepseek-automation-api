#!/usr/bin/env bash
#
# 04 — File uploads.
#
# Covers:
#   - POST /v1/files                            → upload, get file_id
#   - POST /v1/chat/completions (JSON)          → use file_id in messages
#   - POST /v1/chat/completions (multipart)     → attach file(s) directly
#   - Mixed content                             → text + file in one message
#
# IMPORTANT — file_id is single-use in this implementation.
# After a chat request that references a file_id, the file is deleted
# from disk. The next request with the same file_id returns 400.
# To reuse, upload again.
#
# Limits: 100 MB per file, 50 files per request.
#
# Requires: curl, jq
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

TEST_DIR="$SCRIPT_DIR/test_files"

# ---------------------------------------------------------------------
# Test files
# ---------------------------------------------------------------------

prepare_test_files() {
    rm -rf "$TEST_DIR"
    mkdir -p "$TEST_DIR"

    cat > "$TEST_DIR/notes.txt" <<'EOF'
Project notes
-------------
Goal: automate DeepSeek Web via Playwright.
Status: selectors verified, context management done.
Next: finalize documentation.
EOF

    cat > "$TEST_DIR/requirements.md" <<'EOF'
# Requirements

- bash, curl, jq
- Server running at localhost:3000
EOF

    cat > "$TEST_DIR/questions.txt" <<'EOF'
1. When will the next release be?
2. What are the open issues?
3. Who is the maintainer?
EOF
}

cleanup_test_files() {
    rm -rf "$TEST_DIR"
}

# ---------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------

# Usage: upload_file "$API_KEY" /path/to/file
# Prints the file_id on stdout.
upload_file() {
    local api_key="$1"
    local file_path="$2"

    local response
    response=$(curl -sS -X POST "$BASE_URL/v1/files" \
        -H "Authorization: Bearer $api_key" \
        -F "file=@$file_path")

    local file_id
    file_id=$(echo "$response" | jq -r '.id // empty')

    if [[ -z "$file_id" ]]; then
        echo "✗ Upload failed: $response" >&2
        exit 1
    fi

    echo "$file_id"
}

# ---------------------------------------------------------------------
# Multipart chat
# ---------------------------------------------------------------------

# Usage: send_chat_multipart "$API_KEY" '<messages-json>' file1 [file2 ...]
send_chat_multipart() {
    local api_key="$1"
    local messages_json="$2"
    shift 2

    local data
    data=$(jq -n --argjson m "$messages_json" '{messages: $m}')

    # Build curl args dynamically.
    local args=(-sS -X POST "$BASE_URL/v1/chat/completions"
        -H "Authorization: Bearer $api_key")
    for f in "$@"; do
        args+=(-F "files=@$f")
    done
    args+=(-F "data=$data")

    local response
    response=$(curl "${args[@]}")

    local err
    err=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$err" ]]; then
        echo "✗ API error: $err" >&2
        exit 1
    fi

    echo "$response"
}

# ---------------------------------------------------------------------
# JSON chat (for file_id references)
# ---------------------------------------------------------------------

send_chat_json() {
    local api_key="$1"
    local messages_json="$2"

    local payload
    payload=$(jq -n --argjson m "$messages_json" '{messages: $m}')

    local response
    response=$(curl -sS -X POST "$BASE_URL/v1/chat/completions" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "$payload")

    local err
    err=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$err" ]]; then
        echo "✗ API error: $err" >&2
        exit 1
    fi

    echo "$response"
}

# ---------------------------------------------------------------------
# 1. Upload via /v1/files and use file_id
# ---------------------------------------------------------------------

example_file_id() {
    local api_key="$1"
    section "Example 1: upload via /v1/files, use file_id"

    local file_id
    file_id=$(upload_file "$api_key" "$TEST_DIR/notes.txt")
    echo "✓ Uploaded: notes.txt  file_id: $file_id"

    local messages
    messages=$(jq -n --arg fid "$file_id" '[{
        role: "user",
        content: [
            {type: "text", text: "Summarize this in one sentence."},
            {type: "file", file: {file_id: $fid}}
        ]
    }]')

    local response
    response=$(send_chat_json "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 2. Multipart, single file
# ---------------------------------------------------------------------

example_multipart_single() {
    local api_key="$1"
    section "Example 2: multipart, single file"

    local messages
    messages=$(jq -n '[{
        role: "user",
        content: "What are the three questions in the attached file?"
    }]')

    local response
    response=$(send_chat_multipart "$api_key" "$messages" "$TEST_DIR/questions.txt")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 3. Multipart, multiple files
# ---------------------------------------------------------------------

example_multipart_multiple() {
    local api_key="$1"
    section "Example 3: multipart, multiple files"

    local messages
    messages=$(jq -n '[{
        role: "user",
        content: "Compare these files and list what they have in common."
    }]')

    local response
    response=$(send_chat_multipart "$api_key" "$messages" \
        "$TEST_DIR/notes.txt" \
        "$TEST_DIR/requirements.md" \
        "$TEST_DIR/questions.txt")
    print_response "$response"
}

# ---------------------------------------------------------------------
# 4. Mixed: text + file_id in the same message
# ---------------------------------------------------------------------

example_mixed() {
    local api_key="$1"
    section "Example 4: mixed content (text + file_id)"

    local file_id
    file_id=$(upload_file "$api_key" "$TEST_DIR/requirements.md")
    echo "✓ Uploaded: requirements.md  file_id: $file_id"

    local messages
    messages=$(jq -n --arg fid "$file_id" '[{
        role: "user",
        content: [
            {type: "text", text: "Look at the requirements. What tools are needed?"},
            {type: "file", file: {file_id: $fid}}
        ]
    }]')

    local response
    response=$(send_chat_json "$api_key" "$messages")
    print_response "$response"
}

# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

main() {
    banner "04 — File uploads"
    prepare_test_files
    trap cleanup_test_files EXIT

    local api_key
    api_key=$(load_or_register_key)
    example_file_id "$api_key"
    example_multipart_single "$api_key"
    example_multipart_multiple "$api_key"
    example_mixed "$api_key"

    banner "Done."
}

main "$@"