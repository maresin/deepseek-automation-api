"""
03 — Feature toggles.

    extra_body.deepthink   → DeepThink (R1)
    extra_body.web_search  → Web Search

    pip install requests
    python 03_features.py

Toggles are PER-REQUEST. If a request omits deepthink, the server
explicitly disables it before sending — state does not leak between
calls. Pass the flags every time you want them on.

Timing note: DeepThink takes significantly longer (60–120s vs 15–30s).

Context note: DeepThink generates internal reasoning that is not shown
in the final answer but still consumes context. The server multiplies
the response length by DEEPSEEK_DEEPTHINK_MULTIPLIER (default 2.5)
when updating context_status.chars_used. See algorithm C7.
"""

import requests

BASE_URL = "http://localhost:3000"
API_KEY = "deepseek_..."  # replace


# ─────────────────────────────────────────────────────────────────────
# 1. DeepThink (R1) only
# ─────────────────────────────────────────────────────────────────────
#
# Enables DeepThink for this single request. The server clicks the
# toggle before sending, then sends the message.
#
# The toggle does NOT persist. The next request without deepthink
# will explicitly turn it off.

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "user", "content": "Explain quantum entanglement in simple terms."}
        ],
        "extra_body": {"deepthink": True}
    },
    timeout=300,  # DeepThink can take up to ~2 minutes
)

print(r.json()["choices"][0]["message"]["content"])


# ─────────────────────────────────────────────────────────────────────
# 2. Web Search only
# ─────────────────────────────────────────────────────────────────────
#
# Enables Web Search for this single request. Best for recent-events
# questions: without it the model answers from its training cutoff;
# with it, it searches first.

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "user", "content": "What are the latest developments in AI?"}
        ],
        "extra_body": {"web_search": True}
    },
    timeout=180,
)

print(r.json()["choices"][0]["message"]["content"])


# ─────────────────────────────────────────────────────────────────────
# 3. Both at once
# ─────────────────────────────────────────────────────────────────────
#
# DeepThink + Web Search: the model searches, then reasons about the
# results before answering. Slowest mode, most thorough.

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "user", "content":
                "Compare the latest AI regulation proposals in the EU and the US."}
        ],
        "extra_body": {"deepthink": True, "web_search": True}
    },
    timeout=300,
)

print(r.json()["choices"][0]["message"]["content"])


# ─────────────────────────────────────────────────────────────────────
# 4. Reset — omitting extra_body turns both toggles off
# ─────────────────────────────────────────────────────────────────────
#
# Even though the previous request had both toggles on, this one runs
# in plain mode. The server explicitly resets toggles on every request.
# Clients cannot rely on toggle state persisting between calls.

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "user", "content": "What is 2 + 2?"}
        ]
    },
    timeout=180,
)

print(r.json()["choices"][0]["message"]["content"])