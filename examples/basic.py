#!/usr/bin/env python3
"""
Basic example with OpenAI SDK
"""

from openai import OpenAI
import requests
import os

BASE_URL = "http://localhost:3000"
API_KEY_FILE = ".example-api-key"

print("=" * 50)
print("DeepSeek API - OpenAI SDK Example")
print("=" * 50)

# Step 1: Get API key via register endpoint
print("\n1. Getting API key...")
response = requests.post(
    f"{BASE_URL}/v1/register",
    json={"email": "your@email.com", "password": "yourpassword"}
)

if response.status_code != 200:
    print(f"Error: {response.status_code}")
    print(response.text)
    exit(1)

api_key = response.json()["api_key"]
print(f"✓ API key: {api_key}")

# Save for future use
with open(API_KEY_FILE, "w") as f:
    f.write(api_key)

# Step 2: Use OpenAI SDK
print("\n2. Sending request with OpenAI SDK...")
client = OpenAI(
    base_url=f"{BASE_URL}/v1",
    api_key=api_key
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello! Tell me a short joke"}]
)

print(f"✓ Response: {response.choices[0].message.content}")

# Step 3: With tool calling
print("\n3. Tool calling with OpenAI SDK...")
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"]
        }
    }
}]

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "What's the weather in London?"}],
    tools=tools
)

message = response.choices[0].message
if message.tool_calls:
    print("✓ Tool call detected:")
    for tool in message.tool_calls:
        print(f"   {tool.function.name}({tool.function.arguments})")
else:
    print(f"✓ Response: {message.content}")

print("\n" + "=" * 50)
print("OpenAI SDK example completed!")
print("=" * 50)