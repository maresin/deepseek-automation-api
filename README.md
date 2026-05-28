# DeepSeek Automation API

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

OpenAI‑compatible API server for **DeepSeek** (free web version) with tool calling, web search, file upload, DeepThink (R1), session recovery, automatic context management, clipboard isolation, and **optional Retrieval-Augmented Generation (RAG)** for long‑term conversation memory.

> **Why?** DeepSeek offers a powerful free web interface, but no free API. This project automates the web UI using Playwright, giving you a local OpenAI‑compatible API – **completely free**.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration (.env)](#configuration-env)
- [API Endpoints](#api-endpoints)
- [Retrieval-Augmented Generation (RAG)](#retrieval-augmented-generation-rag)
- [Automatic Context Management & Snapshots](#automatic-context-management--snapshots)
- [Known Limitations & Caveats](#known-limitations--caveats)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

Perform the installation according to the instructions.

Then register and chat:

```bash
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'

curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'

curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "files=@file1.pdf" \
  -F "files=@file2.docx" \
  -F 'data={"messages":[{"role":"user","content":"Analyze these documents"}]}'
```

---

## Installation

### Prerequisites
- Node.js **16+** and npm
- A free DeepSeek account (https://chat.deepseek.com)

### Steps

Clone the repository and navigate to the program folder:

```bash
git clone https://github.com/maresin/deepseek-automation-api.git
cd deepseek-automation-api
```
Install the browser dependencies in the program folder:

```bash
npm install               # install dependencies
npm run build             # compile TypeScript
mkdir -p browsers         # create local browser directory
PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium   # install Chromium into ./browsers
```

Create a `.env` file (see [Configuration](#configuration-env) below). Then:

```bash
npm start
```

The server runs on `http://localhost:3000`.

---

## Configuration (.env)

Create a `.env` file in the project root. Below is a minimal example:

```ini
PORT=3000
DEEPSEEK_EMAIL=your@email.com
DEEPSEEK_PASSWORD=your_password
RESTORE_SESSION=false

# RAG features
ENABLE_RAG=true
RAG_CHUNK_SIZE=2000
RAG_FRAGMENT_MAX_CHARS=1200
DEEPSEEK_DEEPTHINK_MULTIPLIER=2.5

# Context limit (characters)
DEEPSEEK_MAX_CONTEXT_CHARS=2400000
```

Full variable reference:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `RESTORE_SESSION` | Restore last chat from browser history on startup | `false` |
| `DEEPSEEK_EMAIL` | Email for auto‑login (optional) | – |
| `DEEPSEEK_PASSWORD` | Password for auto‑login (optional) | – |
| `ENABLE_RAG` | Enable RAG (embedding + search) | `false` |
| `RAG_CHUNK_SIZE` | Characters per chunk (fits embedding model limit) | `2000` |
| `RAG_FRAGMENT_MAX_CHARS` | Max length of retrieved text shown to the model | `1200` |
| `DEEPSEEK_DEEPTHINK_MULTIPLIER` | Multiply response length when DeepThink is on | `2.5` |
| `DEEPSEEK_MAX_CONTEXT_CHARS` | Max context size before auto‑transition | `2400000` |
| `DEEPSEEK_STATE_PATH` | Browser state file path | `./state.json` |
| `DEEPSEEK_API_KEY_PATH` | API key storage path | `./.api-key` |
| `DEEPSEEK_SYSTEM_PROMPT_PATH` | System prompt file path | `./prompts/system_prompt.txt` |

> **Note:** The RAG embedding model (`Xenova/all-MiniLM-L6-v2`) is loaded on the first request – expect a few seconds delay.

---

## API Endpoints

All endpoints follow the OpenAI API specification where applicable.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/register` | Create session and get API key |
| `POST` | `/v1/chat/completions` | Send a message (supports `tools`, `extra_body`) |
| `POST` | `/v1/chat/new` | Create a new chat (optionally restore last chat) |
| `POST` | `/v1/files/upload` | Upload a single file (PDF, image, text, code, etc.) |
| `POST` | `/v1/files/upload-multiple` | Upload up to 10 files |
| `GET` | `/v1/settings/expert/status` | Get current expert/instant mode |
| `GET` | `/health` | Health check |

---

## Retrieval-Augmented Generation (RAG)

When enabled, the API **stores every user–assistant exchange** (and file contents) in a local vector index. Later, when the conversation continues in a **reused chat** (automatic context transition or manual `restore: true`), the system searches the stored history for fragments relevant to the current query and adds them to the prompt.

### When does RAG work?

- **After an automatic context transition** (when the chat reaches ~90% of the limit) → RAG becomes active. The new chat inherits the old `chatId`, so old index entries are **not** cleared.
- **When you manually restore a chat** (`/v1/chat/new` with `{"restore": true}`) → RAG active.
- **When you start a brand new chat** (`/v1/chat/new` with `{"restore": false}`) → **the entire index is cleared**. This is intentional: a fresh topic should not be polluted by old history.

### Example scenario

1. Start a conversation about **physics** (RAG inactive because it's the first chat).
2. Chat long enough to trigger a context transition (or manually restore).
3. Now ask: *“What did we say about quantum mechanics?”* – the model will receive relevant fragments from the previous exchanges.
4. If you later start a **new, unrelated chat** (e.g., `curl -X POST /v1/chat/new`), the index is wiped – the model forgets the physics discussion.

### Performance notes

- Embedding model runs **locally on CPU** – initial load takes ~2–3 seconds, subsequent embeddings are faster.
- Linear search is used (no external FAISS). Works well up to several thousand chunks.
- Chunk size is kept at 2000 characters to respect the embedding model’s 512‑token limit.

---

## Automatic Context Management & Snapshots

The server monitors total character count. When it reaches **70%** of the limit, it creates a `snapshot_70` (a compact summary). When a new message would exceed **90%**:

- If the new total would be **≤95%**, a fresh snapshot (`snapshot_90`) is created.
- Then the browser opens a **new chat**, uploads the latest snapshot, and resets the context counter.
- The user sees **no interruption** – the conversation continues seamlessly.

---

## Known Limitations & Caveats

**Latency**  
Each request takes **15–30 seconds** because it uses a real browser. Designed for batch tasks, not real‑time chat.

**RAG index lifetime**  
Starting a new chat with `restore: false` **permanently deletes all stored embeddings** (old history cannot be retrieved). Use `restore: true` if you want to keep the index.

**DeepThink (R1) token consumption**  
DeepThink generates internal reasoning that is not copied to the final answer but still consumes context. The server multiplies the response length by `DEEPSEEK_DEEPTHINK_MULTIPLIER` (default 2.5) to estimate real usage.

**File uploads**  
Supported types: PDF, images (PNG, JPG, JPEG), text files (TXT, MD, JSON, etc.), code files, office documents (DOC, DOCX, XLS, XLSX, PPT, PPTX).  
Large files are split into chunks (size `RAG_CHUNK_SIZE`) for embedding.

**Tool calling (function calling)**  
The server passes `tools` to DeepSeek and returns `tool_calls` in the OpenAI format. It **does not execute** the tools – you must handle them on the client side.

**Session recovery**  
Session state is stored in `state.json`. If this file is lost or corrupted, you need to re‑register (`/v1/register`). Auto‑login via `.env` credentials can recover from scratch.

---

## Examples

### Simple chat with RAG (after transition)

```bash
# First, create a chat and talk a lot (or trigger a context limit)
curl -X POST /v1/chat/completions ... -d '{"messages":[{"role":"user","content":"Explain quantum entanglement"}]}'

# After automatic transition, ask a follow‑up:
curl -X POST /v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -d '{"messages":[{"role":"user","content":"What were the key experiments?"}]}'
# The answer will include information from the previous conversation.
```

### Manually restore a chat (keep RAG index)

```bash
curl -X POST /v1/chat/new \
  -H "Authorization: Bearer $KEY" \
  -d '{"restore": true}'
```

### Start a fresh chat (wipe RAG index)

```bash
curl -X POST /v1/chat/new \
  -H "Authorization: Bearer $KEY" \
  -d '{"restore": false}'
```

### Upload a file and ask about it

```bash
curl -X POST /v1/files/upload \
  -H "Authorization: Bearer $KEY" \
  -F "file=@document.pdf" \
  -F "message=Summarize this document"
```

---

## Troubleshooting

| Problem | Likely solution |
|---------|------------------|
| `eada-cpu not available` warning | Ignore – linear search fallback works. |
| RAG search returns no results | Ensure `ENABLE_RAG=true`, you have performed previous exchanges, and you are not in a fresh chat (`restore: false`). |
| Long first response (30+ seconds) | Normal – the embedding model loads. |
| Browser window pops up | First run; log in manually once – state is saved. |
| Session not restored after restart | Check that `state.json` and `.api-key` exist and are valid. Delete them and re‑register if needed. |
| Context overflow infinite loop | The server automatically handles it. If you see repeated transitions, lower `DEEPSEEK_MAX_CONTEXT_CHARS` temporarily for testing. |

---

## License

MIT
