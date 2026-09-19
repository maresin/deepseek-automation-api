#!/usr/bin/env python3
"""
04 — File uploads.

Covers:
  - POST /v1/files                            → upload, get file_id
  - POST /v1/chat/completions (JSON)          → use file_id in messages
  - POST /v1/chat/completions (multipart)     → attach file(s) directly
  - Mixed content                             → text + file in one message

Two ways to attach a file:

  A. Upload first via /v1/files, then reference file_id inside a
     normal JSON request. Useful when the same file needs to be sent
     from a client that already has it uploaded.

  B. Attach directly with multipart/form-data to /v1/chat/completions.
     The server receives and forwards the file to DeepSeek UI without
     a prior /v1/files round-trip.

IMPORTANT — file_id is single-use in this implementation.
After a chat request that references a file_id, the file is deleted
from disk (or, if ENABLE_RAG=true, handed to the background indexing
queue and deleted later). The next request with the same file_id will
return 400 "File not found for file_id". To reuse, upload again.

Supported extensions: PDF, DOC(X), XLS(X), PPT(X), images (PNG, JPG,
JPEG, GIF, WEBP, ...), plain text (TXT, MD, CSV, LOG), source code,
JSON, YAML, HTML, CSS. See DEEPSEEK_SUPPORTED_EXTENSIONS in
src/utils/fileUtils.ts.

Limits: 100 MB per file, 50 files per request.
"""

import json
import os
import shutil
import sys
from pathlib import Path

import requests

from common import (
    BASE_URL, banner, section,
    load_or_register_key, print_response,
)


TEST_DIR = Path(__file__).parent / "test_files"


# ---------------------------------------------------------------------
# Test files
# ---------------------------------------------------------------------

def prepare_test_files() -> None:
    """Create a few small text files for the examples."""
    if TEST_DIR.exists():
        shutil.rmtree(TEST_DIR)
    TEST_DIR.mkdir()

    (TEST_DIR / "notes.txt").write_text(
        "Project notes\n"
        "-------------\n"
        "Goal: automate DeepSeek Web via Playwright.\n"
        "Status: selectors verified, context management done.\n"
        "Next: finalize documentation.\n"
    )

    (TEST_DIR / "requirements.md").write_text(
        "# Requirements\n\n"
        "- Python 3.8+\n"
        "- requests\n"
        "- Server running at localhost:3000\n"
    )

    (TEST_DIR / "questions.txt").write_text(
        "1. When will the next release be?\n"
        "2. What are the open issues?\n"
        "3. Who is the maintainer?\n"
    )


def cleanup_test_files() -> None:
    if TEST_DIR.exists():
        shutil.rmtree(TEST_DIR)


# ---------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------

def upload_file(api_key: str, file_path: Path) -> dict:
    """
    POST /v1/files — OpenAI-compatible upload.

    Returns an OpenAI file object:
        { id, object: "file", bytes, created_at, filename, purpose }
    The `id` can be used as file_id in messages.
    """
    with open(file_path, "rb") as f:
        r = requests.post(
            f"{BASE_URL}/v1/files",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (file_path.name, f)},
            timeout=60,
        )

    if r.status_code != 200:
        print(f"✗ Upload failed: HTTP {r.status_code}: {r.text}", file=sys.stderr)
        sys.exit(1)

    return r.json()


# ---------------------------------------------------------------------
# Multipart chat
# ---------------------------------------------------------------------

def send_chat_multipart(api_key: str, messages: list, file_paths: list) -> dict:
    """
    POST /v1/chat/completions with multipart/form-data.

    The server accepts two field names:
        file=<binary>    maxCount=1
        files=<binary>   maxCount=50
    They can be mixed. This helper uses `files` for everything.

    The JSON payload goes into the `data` field.
    """
    handles = [open(p, "rb") for p in file_paths]
    try:
        files_param = [
            ("files", (p.name, fh, "application/octet-stream"))
            for p, fh in zip(file_paths, handles)
        ]
        data_param = {"data": json.dumps({"messages": messages})}

        r = requests.post(
            f"{BASE_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            files=files_param,
            data=data_param,
            timeout=180,
        )
    finally:
        for fh in handles:
            fh.close()

    if r.status_code != 200:
        print(f"✗ HTTP {r.status_code}: {r.text}", file=sys.stderr)
        sys.exit(1)

    return r.json()


# ---------------------------------------------------------------------
# 1. Upload via /v1/files and use file_id
# ---------------------------------------------------------------------

def example_file_id(api_key: str) -> None:
    section("Example 1: upload via /v1/files, use file_id")

    upload_path = TEST_DIR / "notes.txt"
    file_obj = upload_file(api_key, upload_path)
    file_id = file_obj["id"]
    print(f"✓ Uploaded: {file_obj['filename']} ({file_obj['bytes']} bytes)")
    print(f"  file_id: {file_id}")

    # Reference via content array
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Summarize this in one sentence."},
            {"type": "file", "file": {"file_id": file_id}},
        ],
    }]
    data = send_chat_json(api_key, messages)
    print_response(data)


# ---------------------------------------------------------------------
# 2. Multipart, single file
# ---------------------------------------------------------------------

def example_multipart_single(api_key: str) -> None:
    section("Example 2: multipart, single file")

    messages = [{
        "role": "user",
        "content": "What are the three questions in the attached file?",
    }]
    data = send_chat_multipart(api_key, messages, [TEST_DIR / "questions.txt"])
    print_response(data)


# ---------------------------------------------------------------------
# 3. Multipart, multiple files
# ---------------------------------------------------------------------

def example_multipart_multiple(api_key: str) -> None:
    section("Example 3: multipart, multiple files")

    messages = [{
        "role": "user",
        "content": "Compare these files and list what they have in common.",
    }]
    paths = [
        TEST_DIR / "notes.txt",
        TEST_DIR / "requirements.md",
        TEST_DIR / "questions.txt",
    ]
    data = send_chat_multipart(api_key, messages, paths)
    print_response(data)


# ---------------------------------------------------------------------
# 4. Mixed: text + file_id in the same message
# ---------------------------------------------------------------------

def example_mixed(api_key: str) -> None:
    section("Example 4: mixed content (text + file_id)")

    upload_path = TEST_DIR / "requirements.md"
    file_obj = upload_file(api_key, upload_path)
    file_id = file_obj["id"]
    print(f"✓ Uploaded: {file_obj['filename']}  file_id: {file_id}")

    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Look at the requirements. What Python version is needed?"},
            {"type": "file", "file": {"file_id": file_id}},
        ],
    }]
    data = send_chat_json(api_key, messages)
    print_response(data)


# ---------------------------------------------------------------------
# Helper: JSON (non-multipart) request — same as in common.send_chat
# ---------------------------------------------------------------------

def send_chat_json(api_key: str, messages: list) -> dict:
    """
    POST /v1/chat/completions with JSON body.

    Duplicates common.send_chat's core, but is defined here so that this
    file does not depend on the JSON-only helper's payload shape.
    """
    r = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={"messages": messages},
        timeout=180,
    )
    if r.status_code != 200:
        print(f"✗ HTTP {r.status_code}: {r.text}", file=sys.stderr)
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> None:
    banner("04 — File uploads")
    prepare_test_files()

    try:
        api_key = load_or_register_key()
        example_file_id(api_key)
        example_multipart_single(api_key)
        example_multipart_multiple(api_key)
        example_mixed(api_key)
    finally:
        cleanup_test_files()

    banner("Done.")


if __name__ == "__main__":
    main()