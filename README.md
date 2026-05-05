# DeepSeek Automation API

OpenAI-compatible API server for DeepSeek chat with tool calling, web search, file upload, DeepThink (R1) support, session recovery, automatic context management, clipboard isolation, and **Retrieval-Augmented Generation (RAG)** for long‑term conversation memory.

## Why This Exists

DeepSeek (https://chat.deepseek.com/) is a powerful free AI chat service with advanced features. However, the official DeepSeek API is paid. This project creates an **OpenAI‑compatible API server** that automates the DeepSeek web interface using Playwright, giving you programmatic access **for free**.

**What makes this different:**
- Costs nothing (uses the free web interface)
- Supports all web features (DeepThink, web search, file uploads)
- Maintains conversation context automatically
- Can recover interrupted conversations from history
- **Automatically continues long conversations** when the context limit is reached (by transferring the conversation to a new chat)
- **Never interferes with your system clipboard**
- **Optional RAG module** for searching through past conversations (even after context reset)

**The trade‑off:** Because each request uses a real browser (not a direct API), responses take 15–30 seconds. This tool is designed for programmatic tasks where latency is acceptable – batch processing, documentation generation, code analysis, CI/CD pipelines – not for real-time chat applications.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration (.env)](#configuration-env)
- [API Endpoints](#api-endpoints)
- [Retrieval-Augmented Generation (RAG)](#retrieval-augmented-generation-rag)
- [Automatic Context Management & Snapshots](#automatic-context-management--snapshots)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

---

## Installation

### Prerequisites

- **Node.js** 16 or higher
- **npm** 8 or higher
- **Internet connection** (for initial browser download)
- **DeepSeek account** (free at https://chat.deepseek.com/)

### Steps

```bash
# Clone the repository
git clone https://github.com/maresin/deepseek-automation-api.git
cd deepseek-automation-api

# Install dependencies
npm install

# Build TypeScript
npm run build

# Install Chromium browser (Playwright)
npm run postinstall

# Copy environment template and edit
cp .env.example .env   # (see Configuration section below)

# Start the server
npm start
```

Alternatively, use the provided build script:

```bash
chmod +x scripts/build-and-run.sh
./scripts/build-and-run.sh
```

The server runs on `http://localhost:3000` by default.

---

## Quick Start

### 1. Register and get an API key

```bash
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

Response:
```json
{
  "api_key": "deepseek_1734567890123_abc123def456",
  "message": "Store this API key securely."
}
```

### 2. Send a chat message

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer deepseek_1734567890123_abc123def456" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Configuration (.env)

Create a `.env` file in the project root. Below are all available variables.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `RESTORE_SESSION` | Restore last chat from browser history on startup | `false` |
| `DEEPSEEK_EMAIL` | Email for auto‑registration (optional) | – |
| `DEEPSEEK_PASSWORD` | Password for auto‑registration (optional) | – |
| **RAG (Retrieval-Augmented Generation)** | | |
| `ENABLE_RAG` | Enable RAG module (indexing and search) | `false` |
| `RAG_CHUNK_SIZE` | Characters per chunk for embedding (max ~2000 for MiniLM) | `2000` |
| `RAG_FRAGMENT_MAX_CHARS` | Max characters of each retrieved fragment shown to the model | `1200` |
| `DEEPSEEK_DEEPTHINK_MULTIPLIER` | Multiply response length by this when DeepThink is on (rough token estimate) | `2.5` |
| **Context limits** | | |
| `DEEPSEEK_MAX_CONTEXT_CHARS` | Maximum context size in characters before auto‑transition | `2400000` |
| **File paths** | | |
| `DEEPSEEK_STATE_PATH` | Path to browser state file | `./state.json` |
| `DEEPSEEK_API_KEY_PATH` | Path to stored API key | `./.api-key` |
| `DEEPSEEK_SYSTEM_PROMPT_PATH` | Path to system prompt file | `./prompts/system_prompt.txt` |

---

## API Endpoints

All endpoints are documented in the original README. Main ones:

- `POST /v1/register` – Create session and get API key.
- `POST /v1/chat/completions` – Chat (OpenAI compatible).
- `POST /v1/files/upload` – Upload a single file.
- `POST /v1/chat/new` – Create a new chat (optionally restore last chat from history).
- `GET /v1/settings/expert/status` – Get current expert/instant mode.
- `GET /health` – Health check.

---

## Retrieval-Augmented Generation (RAG)

### What it does

When enabled, the API stores every user‑assistant exchange (and file contents) in a vector index using a local embedding model (`Xenova/all-MiniLM-L6-v2`). Later, when the conversation continues in a **new browser chat** (after an automatic context transition or a manual `/v1/chat/new` with `restore: true`), the system searches the stored history for fragments relevant to the current query and adds them to the prompt.

**Important:** The RAG search is **only active** when the current browser session corresponds to a restored or automatically continued chat.  
- If you start a completely new chat (without restoring), the index is **not cleared** but the search will **exclude** entries from other chats (using a `chatId` filter).  
- To force RAG to use only the current chat’s history, you would need to clear the index manually (not recommended).  

In practice, this means:  
- **During a normal browser session (single chat):** RAG will not add any fragments because `inRefreshedChat = false`.  
- **After an automatic context transition (90% limit reached):** RAG becomes active and will search through **previous** chats.  
- **If you manually create a new chat with `restore: true`:** RAG will be active from the start because the restored chat retains the “refreshed” state.  
- **If you create a new chat with `restore: false`:** RAG is inactive (`inRefreshedChat = false`) and the index from previous chats is not used.

### What is indexed

- Every user message + assistant response (combined into one string, then split into chunks).
- File contents (split into chunks, each chunk separately indexed).

### How search works

- The user’s current question is embedded using the same local model.
- The system finds the most similar chunks (cosine similarity) among all stored exchanges **from other chats** (current chat is excluded).
- The corresponding assistant responses are extracted, truncated (keeping the beginning), and inserted into the prompt as a plain text block with a short instruction.

### Performance considerations

- The embedding model runs locally on CPU – first request may take a few seconds to load the model.
- Linear search is used (no external FAISS), which is acceptable for up to several thousand chunks.
- Chunk size is limited to `RAG_CHUNK_SIZE` (default 2000) to fit the embedding model’s token limit (512 tokens ≈ 2000 chars).

### Example `.env` snippet for RAG

```
ENABLE_RAG=true
RAG_CHUNK_SIZE=2000
RAG_FRAGMENT_MAX_CHARS=1200
DEEPSEEK_DEEPTHINK_MULTIPLIER=2.5
```

---

## Automatic Context Management & Snapshots

The API monitors the total character count of the conversation. When it reaches **70%** of the limit (`DEEPSEEK_MAX_CONTEXT_CHARS`), it creates a `snapshot_70` (a condensed summary). When the limit would be exceeded (>90%), it performs an automatic transition:

1. Creates a fresh snapshot (if the new total would be ≤95%) or uses the latest existing snapshot.
2. Opens a new browser chat.
3. Uploads the snapshot as a file.
4. Resets the context counter.
5. Continues the conversation.

The user does not need to do anything – the transition is seamless.

---

## Examples

See the `examples/` folder for ready‑to‑run scripts (both JavaScript and Python).

---

## Troubleshooting

### RAG search returns no results after transition

- Ensure `ENABLE_RAG=true` and you have restarted the server.
- Check that you have performed at least one exchange in the previous chat (so the index contains data).
- If you manually created a new chat with `restore: false`, RAG will be inactive (`inRefreshedChat = false`). Use `restore: true` or wait for an automatic transition.

### Long first response time

- The embedding model is loaded on first request – subsequent requests are faster.
- Browser automation is inherently slow (~15‑30 seconds per request).

### Index files keep growing

You can safely delete the `rag_data` folder to reset the index (all history will be lost).

---

## License

MIT