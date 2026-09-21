# DeepSeek Automation API

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

OpenAI-compatible API server for the **DeepSeek web interface**, driven
by Playwright. Local, free, self-hosted.

DeepSeek offers a capable free web interface but no free API. This
project automates the UI with Playwright and exposes an OpenAI-shaped
HTTP API on top. Everything runs locally: no keys to buy, no quota to
negotiate, no data leaving your machine.

The interesting part is not the automation itself — it is the layers
around it: context management, session recovery, RAG, and error
handling. Those are what turn a browser-driven prototype into something
usable for real, long-running work.

---

## Table of contents

- [Highlights](#highlights)
- [Known problems, addressed](#known-problems-addressed)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API endpoints](#api-endpoints)
- [OpenAI compatibility](#openai-compatibility)
- [Session management and transitions](#session-management-and-transitions)
- [RAG](#rag)
- [Examples](#examples)
- [Testing](#testing)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [License](#license)

---

## Highlights

- **OpenAI-compatible** `/v1/chat/completions`, `/v1/files`, tool
  calling, multi-turn, `system` / `user` / `assistant` roles.
- **Two-phase file upload** — get a `file_id` from `/v1/files`,
  reference it inside `content[]`. Mirrors the OpenAI Assistants flow.
- **Automatic context management** with two thresholds (70% / 90%), a
  single snapshot file, and a transition to a new chat when the limit
  approaches.
- **Optional RAG** over the entire conversation history — linear JSON
  index, local embedding model, no external vector database.
- **Session recovery** across restarts — browser cookies in
  `state.json`, chat session in `chat_state.json`.
- **Four recovery modes**, selected via `.env`: plain (nothing survives
  a transition), snapshot-only, RAG-only, both.
- **DeepThink (R1)** and **Web Search** toggles, per request.
- **Server Busy detection** with a clean shutdown — after DeepSeek
  returns this placeholder, retrying is pointless for hours.
- **Clipboard isolation.** DeepSeek's Copy button writes to
  `navigator.clipboard`, which is shared across pages in a Chromium
  profile. We replace it with a per-page buffer so one request cannot
  read what another copied.
- **Selector validation on startup.** The server refuses to run if
  critical UI selectors are missing. Better a hard failure than silent
  partial behavior.

---

## Known problems, addressed

The failure modes below are not unique to this project — they are
documented in LLM proxies, agent frameworks, and RAG toolkits. What
matters is that each has a concrete, tested solution here.

- **Truncated tool_calls JSON.** DeepSeek Web occasionally drops the
  closing `]}` on long compact output. Bracket-close repair restores
  the frame without touching content; mid-string truncation is
  refused. See [B9](docs/algorithms/response.md#b9).

- **Markdown-polluted tool_calls.** Models wrap JSON in fences or add
  preamble. Balanced-brace extraction handles both, including `{}`
  inside string values. See [B8](docs/algorithms/response.md#b8).

- **RAG temporal blindness.** Pure similarity ranking prefers old,
  semantically rich documents over recent relevant ones. Ranking is
  multiplicative: `similarity × (W + (1−W) × recency)`, keeping
  semantics primary. See [R4](docs/algorithms/rag.md#r4).

- **Context overflow.** Long sessions die silently on other proxies.
  Here, two thresholds (70% / 90%) trigger snapshot and transition,
  with an explicit `finish_reason: "length"` when a response is
  incomplete. See [C3](docs/algorithms/context.md#c3) and
  [A4](docs/algorithms/session.md#a4).

---

## Quick start

```bash
git clone https://github.com/maresin/deepseek-automation-api.git
cd deepseek-automation-api

npm install
npm run build

mkdir -p browsers
PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium
```

Create `.env` (see [Configuration](#configuration)), then:

```bash
npm start
```

The server listens on `http://localhost:3000`. On first launch it
registers a session and writes `.api-key`.

### First request

```bash
# 1. Register — returns an API key
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'

# 2. Chat
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

For Python / JavaScript / cURL walkthroughs covering every endpoint,
see [`examples/`](examples/README.md).

---

## Configuration

Create a `.env` file in the project root. Only `DEEPSEEK_EMAIL` and
`DEEPSEEK_PASSWORD` are needed for automatic login; everything else has
a sensible default.

### Core

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DEEPSEEK_EMAIL` | — | Account email (auto-login) |
| `DEEPSEEK_PASSWORD` | — | Account password (auto-login) |
| `DEEPSEEK_HEADLESS` | `false` | Run Chromium without a window |

### Recovery modes

| Variable | Default | Description |
|---|---|---|
| `ENABLE_RESTORE` | `false` | Reopen the last chat on startup |
| `ENABLE_SNAPSHOT` | `false` | Snapshot cycle at 70% / 90% |
| `ENABLE_RAG` | `false` | Index history and search it after each transition |

### Paths

| Variable | Default | Description |
|---|---|---|
| `DEEPSEEK_STATE_PATH` | `./state.json` | Browser cookies and origins |
| `DEEPSEEK_CHAT_STATE_PATH` | `./chat_state.json` | Chat session state |
| `DEEPSEEK_API_KEY_PATH` | `./.api-key` | API key storage |
| `DEEPSEEK_UPLOAD_DIR` | `./uploads` | Multipart uploads, snapshots, RAG context |

### Context and RAG tuning

| Variable | Default | Description |
|---|---|---|
| `DEEPSEEK_MAX_CONTEXT_CHARS` | `2400000` | Fallback limit before language analysis |
| `DEEPSEEK_DEEPTHINK_MULTIPLIER` | `2.5` | Context multiplier when DeepThink is on |
| `RAG_CHUNK_SIZE` | `2000` | Characters per embedding chunk |
| `RAG_RECENCY_FLOOR` | `0.7` | Minimum recency multiplier in ranking |
| `RAG_DATA_DIR` | `./rag_data` | Directory for per-session indexes |

> The embedding model (`Xenova/all-MiniLM-L6-v2`) is loaded on the first
> RAG request. Expect a 2–3 second delay on that one request.

---

## API endpoints

All endpoints follow the OpenAI specification where applicable.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/register` | Create session, return API key |
| `POST` | `/v1/chat/completions` | Chat (JSON or multipart) |
| `POST` | `/v1/chat/new` | Create a new chat / restore the last |
| `POST` | `/v1/chat/single` | One-shot request in a temporary chat |
| `POST` | `/v1/files` | Upload a file, get a `file_id` |
| `GET` | `/v1/context/status` | Context counter (debugging) |
| `GET` | `/health` | Health check |

### Rate limits

| Group | Limit |
|---|---|
| Global | 100 req/min |
| Chat completions | 30 req/min |
| File upload | 10 req/min |

### Response codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `400` | Validation error |
| `401` | Invalid API key |
| `409` | Context exhausted — see [Session management](#session-management-and-transitions) |
| `503` | DeepSeek backend busy — server shuts down |
| `504` | Timeout waiting for a response |

Every successful chat response includes a `context_status` block with
the current counter and warnings. Clients should inspect it on every
response, not only on failure.

---

## OpenAI compatibility

### Multi-role messages

The OpenAI schema separates `system`, `user`, and `assistant`. DeepSeek
Web has a single textarea and no notion of roles. We bridge this by
prefixing each message in the prompt sent to the UI:

```
System: You are an assistant that speaks like a pirate.
User: Tell me a joke.
Assistant: Why did the pirate go to the Apple Store?
User: Tell me another one.
```

Role prefixes are added when the message array contains a `system`
message **or** more than one entry. A single `user` message without
history is sent as-is, so the simplest possible request — one question,
one answer — looks identical to a normal chat.

### Two-phase file upload

The OpenAI Assistants API splits file handling into two steps: upload a
file, get a `file_id`, then reference it inside a message's `content[]`.
We support the same flow:

```bash
# Step 1: upload, receive a file_id
FILE_ID=$(curl -s -X POST http://localhost:3000/v1/files \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@document.pdf" | jq -r .id)

# Step 2: reference it in a message
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [{
      \"role\": \"user\",
      \"content\": [
        { \"type\": \"text\", \"text\": \"Summarize this.\" },
        { \"type\": \"file\", \"file\": { \"file_id\": \"$FILE_ID\" } }
      ]
    }]
  }"
```

In this implementation `file_id` is **single-use**: after the request
that references it, the file is deleted from disk (or handed to the RAG
indexing queue, which deletes it after indexing). Reusing the same
`file_id` returns `400 File not found for file_id`. To attach the same
file again, upload it again.

This differs from OpenAI, where `file_id` is stable and reusable. The
reason is architectural: every request forwards the file to DeepSeek UI,
and DeepSeek has no concept of stored file references. Making the
semantics explicit here is cheaper than papering over it.

### Tool calling

Tools are passed as JSON in the OpenAI format. The server prepends a
tool-description block and instructs the model to respond with
`{"tool_calls": [{"name": ..., "arguments": {...}}]}`. When that
response comes back, it is reshaped into the OpenAI format with
`message.tool_calls` and `finish_reason: "tool_calls"`.

The server does **not** execute tools. Tool execution is the client's
responsibility — same as OpenAI, same as every well-behaved
OpenAI-compatible server.

### What is not compatible

- **Streaming.** Responses are returned whole. `stream: true` is not
  supported.
- **Embeddings.** No `/v1/embeddings` endpoint.
- **Image generation.** The `vision` input mode is supported (image
  files are accepted), but generation is not.

---

## Session management and transitions

This is the part that separates a working prototype from an API you can
actually run against long conversations.

### Two limits, not one

The server tracks **two independent limits** simultaneously:

| Limit | Where | What it means |
|---|---|---|
| **Estimated** | `context_status.chars_limit` | Our estimate: `1 000 000 tokens × language_coefficient`. May diverge from reality by ±20%. |
| **Real** | `context_status.deepseek_length_limit.readable_percent` | What DeepSeek **actually** read. Appears only when the banner fires. |

Estimated limits are calibrated for **DeepSeek-V4.1-Flash** (the current
Web model, ~1 048 576-token context window) and the language mix of the
session:

| Language | Characters | Coefficient | Source |
|---|---|---|---|
| Latin | 3 000 000 | 3.0 | 0.3 tokens/char; ~10% safety margin |
| Cyrillic | 2 400 000 | 2.4 | 0.42 tokens/char; calibrated empirically |
| CJK | 1 000 000 | 1.0 | 0.6 tokens/char; conservative |

Real sessions mix languages — the coefficient is a weighted average.

The estimate is intentionally the **earlier** of the two signals.
Transitions are triggered by the estimate; the real banner is an
emergency path, not the normal one.

### What happens at a transition

At **70%** the server creates a snapshot (a compact summary of the
conversation, produced with DeepThink). At **90%** the snapshot is
refreshed and the browser opens a **new chat**. The conversation
continues in the new chat — the client sees no interruption.

Three modes are possible, selected by `.env`:

| Mode | What transfers | What is lost |
|---|---|---|
| **Plain** (no flags) | Nothing | Entire history |
| **Snapshot** (`ENABLE_SNAPSHOT=true`) | A compressed summary, ≤10% of the limit | Everything that did not fit in the summary |
| **RAG** (`ENABLE_RAG=true`) | Top-5 fragments semantically close to the current query | Fragments unrelated to the current topic |
| **Both** | Snapshot first, RAG on every subsequent request | See below |

### Quality drops after every transition

This is not a bug. It is a fundamental property of how browser-driven
chat works: the new chat is a fresh model instance with no direct access
to the previous conversation.

**Even with both Snapshot and RAG enabled**, the model treats the
transferred content as a **document**, not as its own memory. In
practice this changes:

- the **tone** — answers become more formal, less confident,
- the **references** — "as we discussed earlier" becomes "according to
  the attached document,"
- the **detail** — the model stops filling gaps that are not in the
  snapshot or fragments,
- the **implicit context** — conventions established earlier in the
  session ("all amounts in rubles") are lost unless they were captured.

**What clients should do.** Keep facts that must survive a transition in
the `system` message. The `system` message is resent on every request
and is not affected by the transition. Conversation history is not a
reliable storage medium for long sessions — the system message is.

### Client responsibilities

A correct client checks `context_status` on **every successful
response**, not only on failure. The four relevant signals are:

| Signal | Meaning | Recommended action |
|---|---|---|
| `warning: "context_above_70"` | Snapshot has been created | Log it. Prepare for a transition. |
| `warning: "context_near_limit"` | Transition scheduled for the next request | Save state locally. |
| HTTP 409 `context_exhausted` | Limit reached | Read `error.recovery`, call `/v1/chat/new`, retry. |
| HTTP 503 `server_busy` | DeepSeek backend refusing | Wait for restart. Do not retry. |

The response to a 409 contains both the estimated and the real
readable percentage, so a client can detect if the estimate is
systematically off and adjust `DEEPSEEK_MAX_CONTEXT_CHARS`.

Full client-side protocol with state diagram and error handling for
every code: [`docs/guides/session-management.md`](docs/guides/session-management.md).
Reference implementation in three languages:
[`examples/05_session.*`](examples/README.md).

---

## RAG

Optional. Off by default. Enabled with `ENABLE_RAG=true`.

### What it does

When enabled, every user–assistant exchange and every text file attached
to a chat is indexed into a per-session local store. After a transition,
each new request runs a semantic search against that index and attaches
the top-5 fragments as a file — with a `system`-level instruction to
treat the file as a trustworthy source.

Nothing is compressed. Fragments are passed verbatim, so exact
formulations and code snippets survive across transitions.

### Design choices worth noting

- **No external vector database.** A linear JSON index of 384-dimensional
  vectors, one file per session, is fast enough for the expected scale
  (thousands of chunks) and keeps deployment to `npm install` + `npx
  playwright install`. No Docker, no separate service, no persistence
  layer to operate.

- **Local embedding model.** `Xenova/all-MiniLM-L6-v2` runs on CPU. No
  API keys, no rate limits, no network calls. First load is 2–3 seconds;
  subsequent embeddings are sub-second.

- **Multiplicative recency ranking.** The final score is
  `similarity × (W + (1 − W) × recency)`, not `α × similarity + (1 − α) ×
  recency`. The additive form does not work: similarity lives in
  0.1–0.5, recency in 0–1, so a fresh but irrelevant fragment easily
  beats an old but relevant one. Multiplication keeps semantics as the
  primary signal and treats recency as a modifier in `[W, 1]`.

- **No feedback loops.** Service files (`snapshot.txt`,
  `rag_context_*.txt`) are explicitly skipped by the indexing queue.
  Without this, RAG output would be re-indexed, and the store would grow
  with copies of its own retrieved content.

- **Background indexing.** Embedding is CPU-bound and can take minutes
  for large files. It runs in a FIFO queue with a single worker,
  decoupled from the HTTP request. The client receives the assistant's
  reply as soon as DeepSeek responds; indexing happens afterward.

- **Chat-scoped search.** Results from the current chat are excluded —
  they are already in the model's context, no need to duplicate them.

- **Index lifetime follows session lifetime.** The index survives
  transitions (that is the whole point) but is cleared on an explicit
  fresh start (`/v1/chat/new {restore: false}`). Starting a genuinely
  new topic should not be polluted by the previous one.

### What RAG does not do

- It does **not** recover the full conversation. Only the top-5
  fragments semantically closest to the current query are attached.
- It does **not** replace the snapshot. Snapshot gives structural
  continuity ("we were working on X, next step is Y"); RAG gives
  topic-specific detail. They complement each other.
- It does **not** eliminate degradation. It reduces the loss; it does
  not remove it.

Full design notes: [`docs/algorithms/rag.md`](docs/algorithms/rag.md).

---

## Examples

The [`examples/`](examples/README.md) directory contains a complete
walkthrough of the API in three languages. Two kinds of examples:

- **Runnable** — Python and JavaScript. Each file runs end-to-end:
  register, chat, print the answer. Edit `API_KEY` at the top, run
  the file, read the output.
- **Reference** — cURL. Each `.sh` file is a sequence of complete
  `curl` commands. Copy a command, paste it into a terminal, run it.

Both styles show the same HTTP contract. Choose the one that matches
how you will consume the API.

| File | Covers |
|---|---|
| `01_getting_started` | Register, health, single user message |
| `02_conversation` | `system` + `user`, multi-turn, tool calling |
| `03_features` | `extra_body.deepthink`, `extra_body.web_search`, both |
| `04_files` | Multipart `files`, two-phase `file_id`, mixed content |
| `05_session` | Context monitoring, 409 / 503 / 401 / 504, transitions, degradation |

No shared helper modules. Each file is self-contained. No third-party
SDKs — the examples show the raw HTTP contract, so `context_status`
and precise error codes stay visible.

**Read `05_session` before building a client.** The first four examples
are optimistic; `05` shows the full client-side protocol, including
what to do when a chat transitions and quality drops. Full discussion:
[`docs/guides/session-management.md`](docs/guides/session-management.md).

---

## Testing

Four independent test suites. Each file in `tests/` covers one aspect.

### Unit tests

Fastest — milliseconds, no server, no browser. Cover the response
parser: markdown fences, preamble, brace balancing, truncation repair,
tool_call normalization.

```bash
npm run test:unit
```

### API integration tests

Verify the HTTP contract: registration, chat completions, tool calling
(simple and complex schemas), file uploads (single, multiple, image,
`file_id`), request validation (401 / 400), context status, temporary
chat.

**Requires a running server** on port 3000:

```bash
npm start                # terminal 1
npm run test:api         # terminal 2
```

### Context-transfer tests

Spawn their own server instance twice — once with `ENABLE_SNAPSHOT=true`,
once with `ENABLE_RAG=true`. Fill a chat with marker files to cross the
70% and 90% thresholds, force a real `handleOverflow`, and verify that a
marker from the old chat survives in the new one. Also verify state
persistence across restarts.

**Requires port 3000 to be free** (the suite manages its own server):

```bash
pkill -f "node server.js"    # if a server is running
npm run test:rag
```

### Selector tests

Validate every UI selector against the live DeepSeek interface. Run
after any change to `src/browser/Selectors.ts` or after a suspected UI
change. Do not require a running API server.

```bash
npm run test:selectors
```

### Port conflicts

`test:api` needs the server running; `test:rag` needs the port free.
Mixing them produces:

```
Error: listen EADDRINUSE: address already in use :::3000
```

```bash
lsof -i :3000              # find the PID
kill <PID>                 # or:
pkill -f "node server.js"  # if it is a stray server
```

See [`tests/README.md`](tests/README.md) for the full troubleshooting
guide.

---

## Limitations

**Latency.** Each request takes **15–30 seconds** — Playwright drives a
real browser. DeepThink requests take 60–120 seconds. This is an
automation layer, not a replacement for a real API. Use it for batch
work, structured long-form tasks, or scenarios where the free tier is
worth the wait.

**Browser automation fragility.** DeepSeek can change their UI at any
time. The `selector-validator` catches this at startup — the server
refuses to run if critical selectors are missing — but a UI change
between restarts will surface as 500s until `Selectors.ts` is updated.
Selector tests exist to make this cheap.

**Estimated limits diverge from real ones.** The language coefficients
are heuristic. Real overflows can happen earlier or later than the
estimate suggests. The divergence is bounded and detectable (compare
`chars_used / chars_limit` with `readable_percent` in a 409), but not
eliminated.

**`file_id` is single-use.** See [OpenAI compatibility](#openai-compatibility).
Different from OpenAI semantics; deliberate.

**No streaming.** Responses are returned whole.

**Single tenant per process.** One API key, one browser, one chat at a
time. Multiple concurrent sessions require multiple processes.

**Server Busy → shutdown.** When DeepSeek returns the busy placeholder,
the server exits after responding with 503. This is intentional: after
that signal, retries fail for hours. A supervisor (systemd, pm2, Docker
restart policy) should decide when to bring it back.

**DeepThink consumes context invisibly.** The reasoning tokens are not
in the final answer but do count toward the limit. The server applies a
`DEEPSEEK_DEEPTHINK_MULTIPLIER` (default 2.5) to keep the estimate
honest.

**Invalid JSON from the model is not repaired.** When the model emits a
long string value with unescaped quotes or literal newlines, the
response cannot be parsed as JSON. This case is intentionally left to
the client — silently patching invalid content risks truncating a
file's body without detection. A pretty-printed format instruction in
`tools_prompt.txt` reduces the frequency but does not eliminate it.

---

## Documentation

Full documentation lives in [`docs/`](docs/index.md) and is built with
MkDocs:

```bash
pip install mkdocs pymdown-extensions
mkdocs serve -f docs/mkdocs.yml
```

Then open `http://127.0.0.1:8000`.

Key sections:

- **[Algorithms](docs/algorithms/index.md)** — contract descriptions of
  every process. Each algorithm is fixed once and does not change without
  a formal replacement. This is the reference for anyone modifying the
  code.
- **[Architecture](docs/architecture/overview.md)** — layers, data flow.
- **[Webapp](docs/webapp/overview.md)** — the DeepSeek UI structure and
  its dynamic states.
- **[Selectors](docs/selectors/catalog.md)** — principles and full
  catalog.
- **[API](docs/api/endpoints.md)** — HTTP reference.
- **[Guides](docs/guides/installation.md)** — installation, usage,
  session management, testing, troubleshooting.

Markdown files are readable directly in `docs/` without building.

---

## License

MIT.
