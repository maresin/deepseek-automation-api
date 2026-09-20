#!/usr/bin/env bash
#
# 04 — File uploads.
#
# Two ways to attach a file:
#
#   A. Multipart form — attach the file directly to the chat request.
#      No prior upload. Simplest path.
#
#   B. Two-phase — upload via POST /v1/files, get a file_id, then
#      reference it inside the messages content array. Mirrors the
#      OpenAI Assistants flow.
#
#     export API_KEY=deepseek_...
#     bash 04_files.sh
#
# IMPORTANT — file_id is single-use in this implementation. After the
# request that references it, the file is deleted from disk (or handed
# to the RAG indexing queue and deleted later). The next request with
# the same file_id returns 400. To reuse, upload again.
#
# Supported extensions: PDF, DOC(X), XLS(X), PPT(X), images, plain text,
# source code, JSON, YAML, HTML, CSS. Limits: 100 MB per file, 50 files
# per request.

BASE_URL=http://localhost:3000

# ─────────────────────────────────────────────────────────────────────
# Prepare test files
# ─────────────────────────────────────────────────────────────────────

printf 'Project notes\n-------------\nGoal: automate DeepSeek Web via Playwright.\nMarker: NOTES42.\n' > /tmp/notes.txt
printf 'Second file. Marker: SECOND99.\n' > /tmp/second.txt

# ─────────────────────────────────────────────────────────────────────
# 1. Multipart — single file, no prior upload
# ─────────────────────────────────────────────────────────────────────
#
# Send the file directly in the chat request using multipart/form-data.
# The file goes into the `files` field; the JSON payload goes into
# the `data` field.
#
# The server forwards the file to DeepSeek's UI. No file_id involved.

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -F "files=@/tmp/notes.txt" \
  -F 'data={"messages":[{"role":"user","content":"What is the marker in this file?"}]}'

# → The marker is NOTES42.

# ─────────────────────────────────────────────────────────────────────
# 2. Multipart — multiple files (up to 50)
# ─────────────────────────────────────────────────────────────────────
#
# Repeat the -F "files=@..." argument for each file. Order is preserved.
# The server validates each file's extension and size individually.

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -F "files=@/tmp/notes.txt" \
  -F "files=@/tmp/second.txt" \
  -F 'data={"messages":[{"role":"user","content":"List the markers from both files."}]}'

# → NOTES42 and SECOND99.

# ─────────────────────────────────────────────────────────────────────
# 3. Two-phase — upload first, get a file_id
# ─────────────────────────────────────────────────────────────────────
#
# OpenAI-compatible endpoint. Returns a file object:
#
#   {
#     "id": "file_1789891863600_abc12345",
#     "object": "file",
#     "bytes": 68,
#     "created_at": 1789891863,
#     "filename": "notes.txt",
#     "purpose": "assistants"
#   }
#
# The `id` can be referenced later inside a message's content array.

curl -X POST $BASE_URL/v1/files \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@/tmp/notes.txt"

# Copy the id from the response, then:
#     FILE_ID=file_1789891863600_abc12345
#     export FILE_ID

# Or capture it in one step:
#     export FILE_ID=$(curl -s -X POST $BASE_URL/v1/files \
#       -H "Authorization: Bearer $API_KEY" \
#       -F "file=@/tmp/notes.txt" | jq -r .id)

# ─────────────────────────────────────────────────────────────────────
# 4. Use file_id in a JSON chat request
# ─────────────────────────────────────────────────────────────────────
#
# Reference the file via the content array — same shape as OpenAI.
# A message can mix text and file parts in any order.

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [{
      \"role\": \"user\",
      \"content\": [
        {\"type\": \"text\", \"text\": \"What is the marker in this file?\"},
        {\"type\": \"file\", \"file\": {\"file_id\": \"$FILE_ID\"}}
      ]
    }]
  }"

# After this request, the file_id is dead. Reusing it returns:
#   400 {"error": "File not found for file_id: file_..."}
# To attach the same file again, upload it again.