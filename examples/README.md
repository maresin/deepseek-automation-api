# Examples

Practical examples for the DeepSeek Automation API — covering every
endpoint, every request variant, and full error handling, in three
languages.

## Prerequisites

- **Running server.** See [installation](../docs/guides/installation.md).
  ```bash
  npm start
  ```

- **Python:** Python 3.8+, `requests`
  ```bash
  pip install requests
  ```

- **JavaScript:** Node.js 18+ (uses native `fetch`, `FormData`, `Blob`)

- **cURL:** `bash`, `curl`, `jq`

The server URL can be overridden via `DEEPSEEK_BASE_URL` (default:
`http://localhost:3000`).

## Quick start

The first example registers a session and saves the API key to
`.examples-api-key` in the current directory. All subsequent examples
reuse that key.

```bash
# Python
cd examples/python
python 01_getting_started.py
python 02_conversation.py
python 03_features.py
python 04_files.py
python 05_session.py

# JavaScript
cd examples/javascript
node 01_getting_started.js
node 02_conversation.js
node 03_features.js
node 04_files.js
node 05_session.js

# cURL
cd examples/curl
./01_getting_started.sh
./02_conversation.sh
./03_features.sh
./04_files.sh
./05_session.sh
```

> **Warning.** Registration creates a session on the server side and
> overwrites `.api-key`. If you already have a running session you care
> about, back up `.api-key` first.

## Files

| File | Covers |
|---|---|
| `01_getting_started` | `GET /health`, `POST /v1/register`, basic `POST /v1/chat/completions` |
| `02_conversation` | `system` + `user`, multi-turn, tool calling (function calling) |
| `03_features` | `extra_body.deepthink`, `extra_body.web_search`, both at once |
| `04_files` | `POST /v1/files`, `file_id` in messages, multipart `file` / `files`, mixed content |
| `05_session` | `POST /v1/chat/new`, `GET /v1/context/status`, `POST /v1/chat/single`, error handling (409 / 503 / 401 / 504) |

Each directory also contains a `common.*` helper module:

| Directory | Helper | Provides |
|---|---|---|
| `python/` | `common.py` | `load_or_register_key`, `send_chat`, `print_response`, `print_context_status`, `banner`, `section` |
| `javascript/` | `common.js` | Same, ES modules |
| `curl/` | `common.sh` | `load_or_register_key`, `send_chat`, `print_response`, `print_context_status`, `banner`, `section` |

## Important: read 05 before building a client

The first four examples are **optimistic**. They assume the session never
overflows and the network is reliable. Real usage is different.

When a chat reaches the context limit, the server transitions to a new
chat. This is a **graceful degradation**, not a seamless continuation:

- **Snapshot** transfers a compressed summary (~10% of the limit). All
  details that did not fit in the summary are lost.
- **RAG** transfers the top-5 fragments semantically close to the
  current query. Fragments unrelated to the current topic do not surface.
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

## Conventions

- **API key** stored in `.examples-api-key` in the current directory.
  All three language subdirectories have their own copy.
- **No third-party SDKs.** The examples show the raw HTTP contract.
  OpenAI SDK is mentioned in `docs/guides/usage.md`, but not used here —
  it hides `context_status` and precise error codes.
- **Non-zero exit** on unexpected errors.
- **`context_status` is printed** after every chat response, so you can
  watch the counter grow.
- **Test files** for `04_files` are created on the fly in
  `test_files/` and removed on exit.

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
| `file_id` in `content[]` | 04 |
| Multipart single file | 04 |
| Multipart multiple files (up to 50) | 04 |
| Mixed text + file | 04 |
| Context monitoring | 05 |
| 409 recovery | 05 |
| 503 handling | 05 |
| 401 re-registration | 05 |
| 504 retry with backoff | 05 |
| Fresh vs restore chat | 05 |
| Temporary chat | 05 |

## Removed examples

Earlier versions of this repository shipped:

- `examples/basic.{js,py}` — covered by `01_getting_started`.
- `examples/advanced.{js,py}` — covered by `02`, `03`, `04`.
- `examples/multiple-files.{js,py}` — covered by `04_files`.
- `examples/register.py` — covered by `01_getting_started`.

They were removed to avoid divergence. A single, up-to-date set of
numbered examples is preferable to two parallel ones, one of which
inevitably rots.

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

**`✗ Invalid API key`** — `.examples-api-key` contains a key that does
not match the server's `.api-key`. Delete `.examples-api-key` and rerun
any example.

**`✗ HTTP 409`** — context is exhausted. `05_session` handles this
automatically. Other examples do not — they assume the session is short.

**`✗ File not found for file_id`** — the `file_id` was already used. In
this implementation, `file_id` is **single-use**: the file is deleted
after the request that referenced it. Upload again to reuse.

**`⚠ DeepSeek server busy`** — the server will shut down in ~500 ms.
This is by design. Wait for an external supervisor to restart it.
