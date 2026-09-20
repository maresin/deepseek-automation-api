"""
01 — Getting started.

Register a session, then send one message.

    pip install requests
    python 01_getting_started.py

Everything here is minimal — two HTTP requests. See the other files
for system prompts, multi-turn history, tool calling, file uploads,
and session management.
"""

import requests

BASE_URL = "http://localhost:3000"


# ─────────────────────────────────────────────────────────────────────
# Step 1. Register a session
# ─────────────────────────────────────────────────────────────────────
#
# A "session" is one API key bound to one active browser chat. You
# only need to do this once — save the key and reuse it.
#
# Response:
#   {
#     "api_key": "deepseek_1789662945767_s8un7bvjft",
#     "message": "Store this API key securely."
#   }

register = requests.post(
    f"{BASE_URL}/v1/register",
    json={
        "email": "your@email.com",
        "password": "your_password",
    },
    timeout=180,
)

print(register.json())
# → {"api_key": "deepseek_...", "message": "Store this API key securely."}


# ─────────────────────────────────────────────────────────────────────
# Step 2. Send a single user message
# ─────────────────────────────────────────────────────────────────────
#
# The simplest possible request: one user message, no history, no
# system prompt.
#
# A single user message without system/history is sent to DeepSeek
# as-is — the server does NOT add "User:" prefixes in this case. This
# keeps simple requests looking like a normal chat. See algorithm B1.
#
# Response shape:
#   {
#     "choices": [{
#       "index": 0,
#       "message": {"role": "assistant", "content": "Hello, API!"},
#       "finish_reason": "stop"
#     }],
#     "usage": {"prompt_tokens": 5, "completion_tokens": 4, ...},
#     "context_status": {
#       "chars_used": 28,
#       "chars_limit": 2400000,
#       "percent_used": 0.0,
#       "language_mix": {"latin": 1.0, ...},
#       "deepseek_length_limit": {"detected": false, "readable_percent": null},
#       "warning": null,
#       "recommendation": null
#     }
#   }

API_KEY = "deepseek_..."  # replace with your key from step 1

response = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "user", "content": "Say 'Hello, API!'"}
        ]
    },
    timeout=180,
)

data = response.json()

print(data["choices"][0]["message"]["content"])
# → Hello, API!

print(data["context_status"])
# → {"chars_used": 28, "chars_limit": 2400000, "percent_used": 0.0, ...}


# ─────────────────────────────────────────────────────────────────────
# What next
# ─────────────────────────────────────────────────────────────────────
#
# Every successful response carries a context_status block. In long
# sessions this becomes the client's early-warning system: the server
# transitions to a new chat at 70% and 90% of the context limit, and
# the client must be prepared for that.
#
# See:
#   02_conversation.py  — system prompts, multi-turn, tool calling
#   03_features.py      — DeepThink, Web Search
#   04_files.py         — file uploads
#   05_session.py       — context monitoring and error handling
#
# Full protocol: docs/guides/session-management.md