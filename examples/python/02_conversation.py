"""
02 — Conversation patterns.

Three ways to structure the messages array.

    pip install requests
    python 02_conversation.py
"""

import requests

BASE_URL = "http://localhost:3000"
API_KEY = "deepseek_..."  # replace with your key from /v1/register


# ─────────────────────────────────────────────────────────────────────
# 1. system + user
# ─────────────────────────────────────────────────────────────────────
#
# The server prepends "System:" and "User:" prefixes to the prompt
# it sends to DeepSeek, because the web interface has a single textarea
# and no notion of roles. See algorithm B1.
#
# Prompt sent to DeepSeek:
#   System: You are an assistant that speaks like a pirate.
#   User: Tell me a short joke.
#
# Response (abbreviated):
#   {"choices": [{"message": {"role": "assistant",
#                             "content": "Why did the pirate..."}}]}

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "system", "content": "You are an assistant that speaks like a pirate."},
            {"role": "user", "content": "Tell me a short joke."},
        ]
    },
    timeout=180,
)

print(r.json()["choices"][0]["message"]["content"])


# ─────────────────────────────────────────────────────────────────────
# 2. Multi-turn (conversation with history)
# ─────────────────────────────────────────────────────────────────────
#
# The full history is sent in one request. The assistant's earlier
# reply becomes part of the prompt. The model sees the thread and
# can follow it.
#
# Prompt sent to DeepSeek:
#   User: What is the capital of France?
#   Assistant: The capital of France is Paris.
#   User: What is the most famous museum there?

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "user", "content": "What is the capital of France?"},
            {"role": "assistant", "content": "The capital of France is Paris."},
            {"role": "user", "content": "What is the most famous museum there?"},
        ]
    },
    timeout=180,
)

print(r.json()["choices"][0]["message"]["content"])
# → The most famous museum in Paris is the Louvre.


# ─────────────────────────────────────────────────────────────────────
# 3. Tool calling (function calling)
# ─────────────────────────────────────────────────────────────────────
#
# Tools are declared in the OpenAI format. When the model decides to
# call a tool, the response contains tool_calls instead of content.
#
# IMPORTANT — the server does NOT execute tools. It only returns the
# call in OpenAI format. Executing the tool and sending the result
# back is the client's responsibility. This is the same contract as
# OpenAI.
#
# Response when the model chooses to call:
#   {
#     "choices": [{
#       "message": {
#         "role": "assistant",
#         "content": null,
#         "tool_calls": [{
#           "id": "call_1789891863600_0",
#           "type": "function",
#           "function": {
#             "name": "get_weather",
#             "arguments": "{\"location\":\"Moscow\"}"
#           }
#         }]
#       },
#       "finish_reason": "tool_calls"
#     }]
#   }
#
# Note: function.arguments is a JSON *string*, not an object.
# Parse it with json.loads(...) on the client side.

r = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [
            {"role": "user", "content": "What is the weather in Moscow?"}
        ],
        "tools": [{
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather for a city",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "City name"
                        }
                    },
                    "required": ["location"]
                }
            }
        }]
    },
    timeout=180,
)

message = r.json()["choices"][0]["message"]

if message.get("tool_calls"):
    call = message["tool_calls"][0]
    print(call["function"]["name"])       # → get_weather
    print(call["function"]["arguments"])  # → {"location":"Moscow"}

    # Parse arguments on the client side:
    import json
    args = json.loads(call["function"]["arguments"])
    print(args["location"])               # → Moscow
else:
    # The model chose not to call — it answered directly.
    print(message["content"])