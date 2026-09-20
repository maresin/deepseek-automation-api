"""
04 — File uploads.

Two ways to attach a file:

  A. Multipart form — attach the file directly to the chat request.
     No prior upload. Simplest path.

  B. Two-phase — upload via POST /v1/files, get a file_id, then
     reference it inside the messages content array. Mirrors the
     OpenAI Assistants flow.

    pip install requests
    python 04_files.py

IMPORTANT — file_id is single-use in this implementation. After the
request that references it, the file is deleted from disk (or handed
to the RAG indexing queue and deleted later). The next request with
the same file_id returns 400. To reuse, upload again.

Supported extensions: PDF, DOC(X), XLS(X), PPT(X), images, plain text,
source code, JSON, YAML, HTML, CSS. Limits: 100 MB per file, 50 files
per request.
"""

import json

import requests

BASE_URL = "http://localhost:3000"
API_KEY = "deepseek_..."  # replace


# ─────────────────────────────────────────────────────────────────────
# Prepare test files
# ─────────────────────────────────────────────────────────────────────

with open("/tmp/notes.txt", "w") as f:
    f.write(
        "Project notes\n"
        "-------------\n"
        "Goal: automate DeepSeek Web via Playwright.\n"
        "Marker: NOTES42.\n"
    )

with open("/tmp/second.txt", "w") as f:
    f.write("Second file. Marker: SECOND99.\n")


# ─────────────────────────────────────────────────────────────────────
# 1. Multipart — single file, no prior upload
# ─────────────────────────────────────────────────────────────────────
#
# Send the file directly in the chat request using multipart/form-data.
# The file goes into the `files` field; the JSON payload goes into
# the `data` field.
#
# The server forwards the file to DeepSeek's UI. No file_id involved.

with open("/tmp/notes.txt", "rb") as f:
    r = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}"},
        files={"files": ("notes.txt", f, "application/octet-stream")},
        data={
            "data": json.dumps({
                "messages": [{
                    "role": "user",
                    "content": "What is the marker in this file?"
                }]
            })
        },
        timeout=180,
    )

print(r.json()["choices"][0]["message"]["content"])
# → The marker is NOTES42.


# ─────────────────────────────────────────────────────────────────────
# 2. Multipart — multiple files (up to 50)
# ─────────────────────────────────────────────────────────────────────
#
# Repeat the `files` field for each file. Order is preserved.
# The server validates each file's extension and size individually.

files = [
    ("files", ("notes.txt", open("/tmp/notes.txt", "rb"), "application/octet-stream")),
    ("files", ("second.txt", open("/tmp/second.txt", "rb"), "application/octet-stream")),
]

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    files=files,
    data={
        "data": json.dumps({
            "messages": [{
                "role": "user",
                "content": "List the markers from both files."
            }]
        })
    },
    timeout=180,
)

for _, (_, fh, _) in files:
    fh.close()

print(r.json()["choices"][0]["message"]["content"])
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

with open("/tmp/notes.txt", "rb") as f:
    upload = requests.post(
        f"{BASE_URL}/v1/files",
        headers={"Authorization": f"Bearer {API_KEY}"},
        files={"file": ("notes.txt", f)},
        timeout=60,
    )

file_obj = upload.json()
print(file_obj)
FILE_ID = file_obj["id"]


# ─────────────────────────────────────────────────────────────────────
# 4. Use file_id in a JSON chat request
# ─────────────────────────────────────────────────────────────────────
#
# Reference the file via the content array — same shape as OpenAI.
# A message can mix text and file parts in any order.

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "What is the marker in this file?"},
                {"type": "file", "file": {"file_id": FILE_ID}}
            ]
        }]
    },
    timeout=180,
)

print(r.json()["choices"][0]["message"]["content"])

# After this request, the file_id is dead. Reusing it returns:
#   400 {"error": "File not found for file_id: file_..."}
# To attach the same file again, upload it again.