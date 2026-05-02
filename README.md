# DeepSeek Automation API

OpenAI-compatible API server for DeepSeek chat with tool calling, web search, file upload, DeepThink (R1) support, session recovery, **automatic context management**, and **clipboard isolation**.

## Why This Exists

**DeepSeek** (https://chat.deepseek.com/) is a powerful free AI chat service with advanced features like DeepThink (R1 reasoning mode), web search, file upload, and expert mode. However, the official DeepSeek API is **paid** — you have to pay for every API call you make.

**The problem:** You cannot use DeepSeek's capabilities in your own applications, scripts, automation workflows, or CI/CD pipelines without paying for the official API. You're forced to either interact manually through the browser or open your wallet.

**The solution:** This project creates an **OpenAI-compatible API server** that connects to the DeepSeek web application (https://chat.deepseek.com/) and automates browser interactions using Playwright. It programmatically sends messages, clicks buttons, uploads files, and reads responses — all through a real browser instance. The result is a fully functional API that mimics OpenAI's format, allowing you to integrate DeepSeek into any application for **free**.

**What makes this different:** Unlike the official API, this tool:
- Costs nothing (uses the free web interface)
- Supports all web features (DeepThink, web search, file uploads)
- Maintains conversation context automatically
- Can recover interrupted conversations from history
- **Automatically continues long conversations** when the context limit is reached (by transferring the conversation to a new chat)
- **Never interferes with your system clipboard** – you can safely copy text while the API is running

**The trade-off:** Because each request uses a real browser (not a direct API), responses take **15-30 seconds**. This tool is designed for programmatic tasks where latency is acceptable — batch processing, documentation generation, code analysis, CI/CD pipelines — not for real-time chat applications.

## How It Works

```
Your Application ⟵ OpenAI-compatible response ⟵ API Server → Browser Automation → chat.deepseek.com
```

1. **API server** receives OpenAI-format requests
2. **Playwright** launches a real Chrome browser
3. **Browser navigates** to https://chat.deepseek.com/
4. **Automation** types messages, clicks buttons, uploads files
5. **Response** is captured from the browser and returned in OpenAI format

## Features

- ✅ **OpenAI Compatible** – Use with OpenAI SDK, cURL, requests, or any OpenAI client
- ✅ **Tool Calling (Function Calling)** – Single and multiple tools
- ✅ **DeepThink (R1)** – Reasoning mode for complex tasks
- ✅ **Web Search** – Real-time internet search
- ✅ **Expert/Instant Mode** – Switch between response styles
- ✅ **File Upload** – PDF, images, text, code, office documents
- ✅ **Session Persistence** – Login once, browser state saved
- ✅ **Session Recovery** – Resume last chat from history on startup
- ✅ **Automatic Context Management** – The API tracks conversation size (up to 2.4 million characters of plain text) and seamlessly continues the chat when the limit is reached, using internal snapshots to preserve history.
- ✅ **Clipboard Isolation** – The browser’s clipboard is completely emulated in memory; your system clipboard is never touched. You can safely copy text in other applications while the API is running.
- ✅ **Cross-Platform** – Works on Linux, Windows, macOS

## Use Cases

- **VSCode extension** – Add DeepSeek as an AI provider in your IDE
- **Automation scripts** – Process documents, analyze code, generate documentation
- **CI/CD pipelines** – Automate code review and quality checks
- **Personal tools** – Integrate AI assistance into your workflow
- **Testing** – Evaluate DeepSeek capabilities programmatically
- **Content generation** – Batch process documents or articles
- **Long-running tasks** – Automatic context continuation means no manual intervention

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Usage](#usage)
  - [Starting the Server](#starting-the-server)
  - [Getting an API Key](#getting-an-api-key)
  - [Basic Chat](#basic-chat)
  - [Tool Calling (Function Calling)](#tool-calling-function-calling)
  - [DeepThink, Web Search, Expert Mode](#deepthink-web-search-expert-mode)
  - [File Upload](#file-upload)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [Reporting Issues](#reporting-issues)
- [License](#license)

## Quick Start

```bash
# Clone the project
git clone https://github.com/maresin/deepseek-automation-api.git
cd deepseek-automation-api

# Quick setup (Linux/macOS)
./scripts/setup.sh

# Or step by step:
npm install                 # Install dependencies
npm run build              # Build TypeScript
npm run postinstall        # Install Chromium browser (~300 MB)
npm start                  # Start the server

# In another terminal, get an API key
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'

# Send a message
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello!"}]}'
```

## Installation

### Prerequisites

- **Node.js** 16 or higher
- **npm** 8 or higher
- **Internet connection** (for initial browser download)
- **DeepSeek account** (free at https://chat.deepseek.com/)

### Installation Steps

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Install Playwright browser
npm run postinstall

# Start the server
npm start
```

The server runs on `http://localhost:3000`

### Platform Notes

| Platform | Notes |
|----------|-------|
| **Linux** | Works out of the box |
| **Windows** | Works out of the box |
| **macOS** | Works out of the box |

## Usage

### Starting the Server

```bash
# Normal start
npm start

# Or directly
node server.js

# With session recovery (resume last chat from history)
RESTORE_SESSION=true node server.js

# On a different port
PORT=3001 node server.js

# Background start (Linux/macOS)
nohup node server.js > server.log 2>&1 &

# Background start (Windows)
start /B node server.js > server.log 2>&1
```

### Getting an API Key

**Auto-login (with your DeepSeek credentials):**

```bash
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

**Manual login (browser opens, log in yourself):**

```bash
curl -X POST http://localhost:3000/v1/register -d '{}'
```

**Response:**

```json
{
  "api_key": "<YOUR_API_KEY>",
  "message": "Store this API key securely. It will not be shown again."
}
```

> **Save your API key!** It won't be shown again. If lost, delete `.api-key` and `state.json` and re-register.

### Basic Chat

> **Note:** You don't need to send previous messages — the session remembers context automatically, and the API will automatically continue the conversation if the context limit is reached.

#### cURL

```bash
# First request (creates session automatically)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "your_password",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Subsequent requests (with API key)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer deepseek_1734567890123_abc123def456" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "How are you?"}]
  }'
```

#### Python (requests)

```python
import requests

# First request (creates session)
resp = requests.post(
    "http://localhost:3000/v1/chat/completions",
    json={
        "email": "your@email.com",
        "password": "your_password",
        "messages": [{"role": "user", "content": "Hello!"}]
    }
)

# API key is returned in the response header
api_key = resp.headers.get("X-API-Key")
print(f"Your API key: {api_key}")
print(resp.json()["choices"][0]["message"]["content"])

# Subsequent requests
resp = requests.post(
    "http://localhost:3000/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}"},
    json={"messages": [{"role": "user", "content": "Tell me a joke"}]}
)
print(resp.json()["choices"][0]["message"]["content"])
```

#### Python (OpenAI SDK)

```python
from openai import OpenAI
import requests

# Step 1: Register and get API key
resp = requests.post(
    "http://localhost:3000/v1/register",
    json={"email": "your@email.com", "password": "your_password"}
)
api_key = resp.json()["api_key"]
print(f"Your API key: {api_key}")

# Step 2: Use OpenAI SDK with your API key
client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key=api_key
)

# Send a message
response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

#### JavaScript (fetch)

```javascript
// First request (creates session)
const response = await fetch("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        email: "your@email.com",
        password: "your_password",
        messages: [{ role: "user", content: "Hello!" }]
    })
});

const data = await response.json();
const apiKey = response.headers.get("X-API-Key");
console.log("Your API key:", apiKey);
console.log(data.choices[0].message.content);

// Subsequent requests
const response2 = await fetch("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
    },
    body: JSON.stringify({
        messages: [{ role: "user", content: "Tell me a joke" }]
    })
});

const data2 = await response2.json();
console.log(data2.choices[0].message.content);
```

### Tool Calling (Function Calling)

Define tools in your request. The model will respond with `tool_calls` JSON.

#### cURL

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is the weather in Moscow?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
          "type": "object",
          "properties": {"location": {"type": "string"}},
          "required": ["location"]
        }
      }
    }]
  }'
```

#### Python (requests)

```python
import requests

API_KEY = "<YOUR_API_KEY>"

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"]
        }
    }
}]

response = requests.post(
    "http://localhost:3000/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "What is the weather in Moscow?"}],
        "tools": tools
    }
)

data = response.json()
message = data["choices"][0]["message"]

if message.get("tool_calls"):
    for tool in message["tool_calls"]:
        print(f"Function: {tool['function']['name']}")
        print(f"Arguments: {tool['function']['arguments']}")
else:
    print(message["content"])
```

#### Python (OpenAI SDK)

```python
from openai import OpenAI

API_KEY = "<YOUR_API_KEY>"

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key=API_KEY
)

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"]
        }
    }
}]

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "What is the weather in Moscow?"}],
    tools=tools
)

message = response.choices[0].message
if message.tool_calls:
    for tool in message.tool_calls:
        print(f"Function: {tool.function.name}")
        print(f"Arguments: {tool.function.arguments}")
else:
    print(message.content)
```

### DeepThink, Web Search, Expert Mode

Pass features in `extra_body`.

| Feature | Field | Description |
|---------|-------|-------------|
| DeepThink (R1) | `deepthink` | Reasoning mode for complex tasks |
| Web Search | `web_search` | Real-time internet search |
| Expert Mode | `expert_mode` | More detailed responses |

#### cURL

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Explain quantum physics simply"}],
    "extra_body": {
      "deepthink": true,
      "web_search": true,
      "expert_mode": true
    }
  }'
```

#### Python (requests)

```python
import requests

API_KEY = "<YOUR_API_KEY>"

response = requests.post(
    "http://localhost:3000/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "Explain quantum physics simply"}],
        "extra_body": {
            "deepthink": True,
            "web_search": True,
            "expert_mode": True
        }
    }
)

print(response.json()["choices"][0]["message"]["content"])
```

### File Upload

**Supported file types:** PDF, images (PNG, JPG, JPEG), text files (TXT, MD, JSON), code files (PY, JS, TS, etc.), office documents (DOC, DOCX, XLS, XLSX, PPT, PPTX)

#### cURL

```bash
# Single file
curl -X POST http://localhost:3000/v1/files/upload \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@document.pdf"

# Multiple files
curl -X POST http://localhost:3000/v1/files/upload-multiple \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "files=@file1.txt" \
  -F "files=@file2.pdf" \
  -F "files=@image.jpg"
```

#### Python (requests)

```python
import requests

API_KEY = "<YOUR_API_KEY>"

# Single file
with open("document.pdf", "rb") as f:
    response = requests.post(
        "http://localhost:3000/v1/files/upload",
        headers={"Authorization": f"Bearer {API_KEY}"},
        files={"file": f}
    )
print(response.json())

# Multiple files
files = [
    ("files", open("file1.txt", "rb")),
    ("files", open("file2.pdf", "rb"))
]
response = requests.post(
    "http://localhost:3000/v1/files/upload-multiple",
    headers={"Authorization": f"Bearer {API_KEY}"},
    files=files
)
print(response.json())
```

## API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/register` | Get API key (auto or manual login) |
| POST | `/v1/chat/completions` | Chat (OpenAI compatible) |
| POST | `/v1/files/upload` | Upload single file |
| POST | `/v1/files/upload-multiple` | Upload multiple files |
| POST | `/v1/chat/new` | Create new chat (with expert mode toggle) |
| GET | `/v1/settings/expert/status` | Get current expert/instant mode |
| GET | `/health` | Server health check |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/v1/chat/completions` | 30 requests | 1 minute |
| `/v1/files/upload` | 10 uploads | 1 minute |
| `/v1/files/upload-multiple` | 10 uploads | 1 minute |
| Global | 100 requests | 1 minute |

### Response Format (OpenAI Compatible)

```json
{
  "id": "chatcmpl-1734567890123",
  "object": "chat.completion",
  "created": 1734567890,
  "model": "deepseek-chat",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  }
}
```

### Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing parameters) |
| 401 | Invalid or missing API key |
| 429 | Rate limit exceeded |
| 500 | Server error (check logs) |

## Examples

The `examples/` folder contains ready-to-run scripts:

```bash
# JavaScript examples
node examples/basic.js          # Basic chat
node examples/advanced.js       # Advanced usage
node examples/with-tools.js     # Tool calling
node examples/with-features.js  # DeepThink, web search

# Python examples
python examples/basic.py
python examples/advanced.py
python examples/with-tools.py
python examples/with-features.py
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `RESTORE_SESSION` | Restore last chat from history on startup | `false` |
| `DEEPSEEK_EMAIL` | Email for auto-registration | - |
| `DEEPSEEK_PASSWORD` | Password for auto-registration | - |

```bash
# Start with session recovery
RESTORE_SESSION=true node server.js

# On a different port with recovery
RESTORE_SESSION=true PORT=3001 node server.js
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Build TypeScript |
| `npm run postinstall` | Install Chromium browser |
| `npm start` | Start the server |
| `npm run clean` | Clean temporary files (dist, browsers, state.json, .api-key) |
| `npm run dev` | Start with auto-reload (nodemon) |
| `./scripts/setup.sh` | Complete automated setup (Linux/macOS) |
| `node scripts/install-browser.js` | Install browser via Playwright |

## Troubleshooting

### First Run: Browser Opens, Need to Login

**Problem:** First launch opens a browser window asking for DeepSeek login.

**Solution:** Log in manually. The session will be saved to `state.json` for future runs.

### "Chromium not found" Error

**Problem:** Playwright browser missing.

**Solution:**
```bash
npm run postinstall
```

### Slow Responses

**Reason:** Each request requires real browser automation (15-30 seconds).

**Workaround:** Use tool calling for structured responses (faster) or reduce message length.

### Rate Limit Errors (429)

**Reason:** Too many requests per minute.

**Solution:** Reduce request frequency. Realistic limit: ~3-4 requests per minute.

### Server Won't Start (Port in use)

**Solution:**
```bash
# Find process on port 3000
lsof -i :3000
kill -9 <PID>

# Or use a different port
PORT=3001 node server.js
```

### Session Not Saved

**Solution:** Ensure `state.json` is writable. Delete it to force re-login.

### API Returns Empty or Incomplete Responses

**Problem:** Browser window closed or clipboard interference (with new clipboard isolation this is rare).

**Solution:**
- Ensure browser window is open (can be minimized).
- Check if DeepSeek website changed (open it manually).
- Restart the server.

### Context Limit Reached – Automatic Continuation

The API handles context limits automatically. You will see log messages like `⚠️ Context at ...% – transition flagged` and `🔄 Starting transition to new chat`. No action is needed from you.

### Clipboard Interference

**The API now isolates its clipboard operations completely.** You can safely copy text in other applications while the API is running — your clipboard will never be overwritten.

### API Stops Working After DeepSeek Website Update

**Problem:** DeepSeek changed their website structure (HTML, CSS, or DOM).

**Solution:**
1. Check for a new release of this project
2. If no release exists, open a GitHub issue describing the problem
3. We will investigate and release an updated version

## Reporting Issues

If you encounter problems:

1. **Check the logs** – Server console output contains detailed information
2. **Verify DeepSeek website** – Try accessing https://chat.deepseek.com/ manually
3. **Update to latest version** – `git pull && npm run build`
4. **Open an issue** with:
   - Server version
   - Operating system
   - Error messages
   - Steps to reproduce
   - Whether DeepSeek website changed (if known)

## License

MIT

## Support

For issues, check:
- Server logs (console output)
- `state.json` (session data)
- Browser window (manual intervention may be needed)
- GitHub issues (known problems and solutions)
