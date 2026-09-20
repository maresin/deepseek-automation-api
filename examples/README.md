# Examples

Practical examples for the DeepSeek Automation API — covering every
endpoint, every request variant, and full error handling, in three
languages.

## Two kinds of examples

- **Runnable** — Python and JavaScript. Each file runs end-to-end:
  register, chat, print the answer. Edit `API_KEY` at the top, run the
  file, read the output.
- **Reference** — cURL. Each `.sh` file is a sequence of complete
  `curl` commands. Copy a command, paste it into a terminal, run it.
  The files are not meant to be executed as a whole.

Both styles show the same HTTP contract. Choose the one that matches
how you will consume the API.

## Prerequisites

- **Running server.** See [installation](../docs/guides/installation.md).
  ```bash
  npm start
  ```

- **Python:** 3.8+, `requests`
  ```bash
  pip install requests
  ```

- **JavaScript:** Node.js 18+ (native `fetch`, `FormData`, `Blob`,
  top-level `await`)

- **cURL:** `bash`, `curl`, optionally `jq` for pretty output

The server URL can be overridden via `DEEPSEEK_BASE_URL` (default:
`http://localhost:3000`).

## Quick start

### 1. Get an API key

```bash
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

Response:

```json
{
  "api_key": "deepseek_1789662945767_s8un7bvjft",
  "message": "Store this API key securely."
}
```

### 2. Run a Python example

```bash
cd examples/python
# Open 01_getting_started.py, replace API_KEY = "deepseek_..." with your key
python 01_getting_started.py
```

### 3. Run a JavaScript example

```bash
cd examples/javascript
# Open 01_getting_started.js, replace API_KEY = 'deepseek_...' with your key
node 01_getting_started.js
```

### 4. Read a cURL example

```bash
export API_KEY=deepseek_1789662945767_s8un7bvjft
cat examples/curl/01_getting_started.sh
# Copy-paste individual curl commands into your terminal
```

## Files

| File | Covers |
|---|---|
| `01_getting_started` | Register, health, single user message |
| `02_conversation` | `system` + `user`, multi-turn, tool calling |
| `03_features` | `extra_body.deepthink`, `extra_body.web_search`, both |
| `04_files` | Multipart `files`, two-phase `file_id`, mixed content |
| `05_session` | Context monitoring, 409 / 503 / 401 / 504, transitions, degradation |

Every example exists in three languages:

```
examples/
├── python/
│   ├── 01_getting_started.py
│   ├── 02_conversation.py
│   ├── 03_features.py
│   ├── 04_files.py
│   └── 05_session.py
├── javascript/
│   ├── 01_getting_started.js
│   ├── 02_conversation.js
│   ├── 03_features.js
│   ├── 04_files.js
│   └── 05_session.js
└── curl/
    ├── 01_getting_started.sh
    ├── 02_conversation.sh
    ├── 03_features.sh
    ├── 04_files.sh
    └── 05_session.sh
```

No shared helper modules. Each file is self-contained.

## Important: read 05 before building a client

The first four examples are **optimistic**. They assume the session
never overflows and the network is reliable. Real usage is different.

When a chat reaches the context limit, the server transitions to a new
chat. This is **graceful degradation**, not a seamless continuation:

- **Snapshot** transfers a compressed summary (~10% of the limit).
  Everything that did not fit in the summary is lost.
- **RAG** transfers the top-5 fragments semantically close to the
  current query. Fragments unrelated to the current topic do not
  surface.
- **Both** combine, but the model still treats the transferred data as
  a **document**, not as its own memory.

The practical consequence: after a transition you cannot rely on
"it remembers everything." Critical facts must either live in the
`system` message (resent on every request), or be restated.

`05_session` shows the full client-side protocol:

- Monitor `context_status` on every response.
- Handle **HTTP 409** (`context_exhausted`) — read `error.recovery`,
  call `POST /v1/chat/new`, retry the original request.
- Handle **HTTP 503** (`server_busy`) — save state, wait for restart.
  Do **not** retry; the server is shutting down by design.
- Handle **HTTP 401** — re-register via `/v1/register`.
- Handle **HTTP 504** — retry with exponential backoff.
- Understand the difference between the **estimated** limit
  (`chars_limit`) and the **real** limit
  (`deepseek_length_limit.readable_percent`).

Full discussion: [Session management](../docs/guides/session-management.md).

## Endpoint coverage

| Endpoint | 01 | 02 | 03 | 04 | 05 |
|---|---|---|---|---|---|
| `GET /health` | ✓ | | | | |
| `POST /v1/register` | ✓ | | | | |
| `POST /v1/chat/completions` (JSON) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `POST /v1/chat/completions` (multipart) | | | | ✓ | |
| `POST /v1/files` | | | | ✓ | |
| `POST /v1/chat/new` | | | | | ✓ |
| `POST /v1/chat/single` | | | | | ✓ |
| `GET /v1/context/status` | | | | | ✓ |

## Feature coverage

| Feature | Where |
|---|---|
| Single user message | 01 |
| `system` + `user` | 02 |
| Multi-turn history | 02 |
| Tool calling (`tools`) | 02 |
| `extra_body.deepthink` | 03 |
| `extra_body.web_search` | 03 |
| Multipart single file | 04 |
| Multipart multiple files (up to 50) | 04 |
| Two-phase upload (`file_id`) | 04 |
| Mixed text + file | 04 |
| Context monitoring | 05 |
| 409 recovery | 05 |
| 503 handling | 05 |
| 401 re-registration | 05 |
| 504 retry with backoff | 05 |
| Fresh vs restore chat | 05 |
| Temporary chat | 05 |

## Related documentation

- [Installation](../docs/guides/installation.md) — requirements, `.env`,
  first launch.
- [Usage](../docs/guides/usage.md) — endpoint examples, context status,
  degradation, scenarios.
- [Session management](../docs/guides/session-management.md) — full
  client-side protocol, two limits, error codes, degradation.
- [API endpoints](../docs/api/endpoints.md) — full HTTP reference.
- [Algorithms](../docs/algorithms/index.md) — contract descriptions of
  every process in the API.

## Troubleshooting

**`✗ Server unreachable`** — the server is not running. Start it with
`npm start` in the project root.

**`✗ Invalid API key`** — `API_KEY` in the example does not match the
server's `.api-key`. Re-register via `/v1/register` and update the
example.

**`✗ HTTP 409`** — context is exhausted. `05_session` handles this
automatically. Other examples do not — they assume the session is
short. Call `POST /v1/chat/new {restore: false}` before retrying.

**`✗ File not found for file_id`** — the `file_id` was already used.
In this implementation, `file_id` is **single-use**: the file is
deleted after the request that referenced it. Upload again to reuse.

**`⚠ DeepSeek server busy`** — the server shuts down ~500 ms after
responding. This is by design. Wait for an external supervisor to
restart it.

**`EADDRINUSE: address already in use :::3000`** — port 3000 is held
by another process. See `tests/README.md` → "Port already in use".