#!/usr/bin/env python3
"""
Advanced example - demonstrates all features:
- Tool calling (function calling)
- DeepThink (R1) mode
- Web search
- Expert mode
- File upload
- Session recovery with RESTORE_SESSION
"""

import requests
import os
import time

BASE_URL = "http://localhost:3000"
API_KEY = None

# Try to load existing API key
if os.path.exists(".example-api-key"):
    with open(".example-api-key", "r") as f:
        API_KEY = f.read().strip()
        print(f"✓ Loaded existing API key: {API_KEY}")

# If no API key, register first
if not API_KEY:
    print("\n1. Registering new session...")
    response = requests.post(
        f"{BASE_URL}/v1/register",
        json={"email": "your@email.com", "password": "yourpassword"}
    )
    
    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        print(response.text)
        exit(1)
    
    API_KEY = response.json()["api_key"]
    print(f"✓ API key received: {API_KEY}")
    
    # Save for future runs
    with open(".example-api-key", "w") as f:
        f.write(API_KEY)

print("\n" + "=" * 60)
print("DeepSeek API - Advanced Examples")
print("=" * 60)

# ============================================================
# Example 1: Tool Calling (Function Calling)
# ============================================================
print("\n📌 Example 1: Tool Calling (Function Calling)")
print("-" * 40)

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "City name"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["location"]
        }
    }
}]

response = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "What's the weather in Moscow?"}],
        "tools": tools
    }
)

data = response.json()
message = data["choices"][0]["message"]

if message.get("tool_calls"):
    print("✓ Tool call detected:")
    for tool in message["tool_calls"]:
        print(f"   Function: {tool['function']['name']}")
        print(f"   Arguments: {tool['function']['arguments']}")
else:
    print(f"✓ Response: {message['content']}")

# ============================================================
# Example 2: DeepThink (R1) Mode
# ============================================================
print("\n📌 Example 2: DeepThink (R1) Mode")
print("-" * 40)

start_time = time.time()

response = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "Explain quantum entanglement in simple terms"}],
        "extra_body": {"deepthink": True}
    }
)

duration = time.time() - start_time
data = response.json()
print(f"✓ Response (took {duration:.1f}s):")
print(f"   {data['choices'][0]['message']['content'][:200]}...")

# ============================================================
# Example 3: Web Search
# ============================================================
print("\n📌 Example 3: Web Search")
print("-" * 40)

response = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "What are the latest news about AI?"}],
        "extra_body": {"web_search": True}
    }
)

data = response.json()
print(f"✓ Response with web search:")
print(f"   {data['choices'][0]['message']['content'][:200]}...")

# ============================================================
# Example 4: Expert Mode
# ============================================================
print("\n📌 Example 4: Expert Mode (more detailed responses)")
print("-" * 40)

response = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "Explain what is an API"}],
        "extra_body": {"expert_mode": True}
    }
)

data = response.json()
print(f"✓ Expert mode response:")
print(f"   {data['choices'][0]['message']['content'][:200]}...")

# ============================================================
# Example 5: Combined Features
# ============================================================
print("\n📌 Example 5: All Features Combined")
print("-" * 40)

response = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "Analyze the future of renewable energy"}],
        "extra_body": {
            "deepthink": True,
            "web_search": True,
            "expert_mode": True
        }
    }
)

data = response.json()
print(f"✓ Response with all features:")
print(f"   {data['choices'][0]['message']['content'][:200]}...")

# ============================================================
# Example 6: File Upload
# ============================================================
print("\n📌 Example 6: File Upload")
print("-" * 40)

# Create a test file
with open("/tmp/test_upload.txt", "w") as f:
    f.write("This is a test file for DeepSeek API.\nIt contains some sample text.\nPlease summarize this.")

with open("/tmp/test_upload.txt", "rb") as f:
    response = requests.post(
        f"{BASE_URL}/v1/files/upload",
        headers={"Authorization": f"Bearer {API_KEY}"},
        files={"file": f}
    )

if response.status_code == 200:
    print(f"✓ File uploaded successfully: {response.json()}")
    
    # Now ask about the uploaded file
    response = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={
            "messages": [{"role": "user", "content": "What was in the file I just uploaded? Please summarize."}]
        }
    )
    
    data = response.json()
    print(f"✓ Response about file:")
    print(f"   {data['choices'][0]['message']['content'][:200]}...")

# Clean up
os.remove("/tmp/test_upload.txt")

print("\n" + "=" * 60)
print("Advanced example completed!")
print("=" * 60)
print("\n💡 Tip: Run with RESTORE_SESSION=true to resume last chat")
print("   RESTORE_SESSION=true node server.js")