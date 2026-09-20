#!/usr/bin/env bash
#
# 02 — Conversation patterns.
#
# Three ways to structure the messages array.
#
#     export API_KEY=deepseek_...
#     bash 02_conversation.sh

BASE_URL=http://localhost:3000

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

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role":"system","content":"You are an assistant that speaks like a pirate."},
      {"role":"user","content":"Tell me a short joke."}
    ]
  }'

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

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role":"user","content":"What is the capital of France?"},
      {"role":"assistant","content":"The capital of France is Paris."},
      {"role":"user","content":"What is the most famous museum there?"}
    ]
  }'

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
# On the client side, parse it with JSON.parse / json.loads / jq:
#
#   echo "$response" | jq -r '.choices[0].message.tool_calls[0].function.arguments' \
#     | jq '.location'
#   → "Moscow"

curl -X POST $BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"What is the weather in Moscow?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type":"string","description":"City name"}
          },
          "required": ["location"]
        }
      }
    }]
  }'