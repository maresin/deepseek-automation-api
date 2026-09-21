# Tests for DeepSeek Automation API

Test suites for the DeepSeek Automation API project.

## Structure

```
tests/
├── README.md                          # This file
├── config.env                         # SERVER_URL, TEST_DATA_DIR
├── data/                              # Input files for tests
│   └── images/
│       └── lenna.png                  # Standard test image
├── api.test.js                        # API integration
├── context-transfer.test.js           # Snapshot / RAG transition
├── selectors.test.js                  # Selector validation (Playwright)
└── response-parser.test.js            # Unit tests (no server required)
```

Four test files. Each covers one aspect. The first two require a
running server; the third requires browser cookies; the last requires
nothing.

---

## Test types

### 1. `api.test.js` — API integration

**What it tests:**
- Registration (`/v1/register`)
- Session state (`/v1/chat/new`, `chat_state.json`)
- Basic chat completion (`/v1/chat/completions`)
- DeepThink and Web Search toggles
- Tool calling — simple and complex schemas
- File upload (single, multiple, image, `file_id` reference)
- Request validation (401, 400 for various malformed inputs)
- Context status (`/v1/context/status`)
- Temporary chat (`/v1/chat/single`) with `return_only` and
  `insert_to_context`

**Run:**

```bash
npm run test:api
```

**Requires:** a running server on port 3000 (`npm start` in another
terminal).

---

### 2. `context-transfer.test.js` — snapshot / RAG transitions

**What it tests:**
- Snapshot cycle: `snapshot70Done`, `snapshot90Done`,
  `snapshot.txt` creation and cleanup
- RAG cycle: `ragSearchActive` activation, index cleanup
- Actual context transfer across a chat transition (marker-file
  recall)
- State persistence across server restarts
- Near-limit file handling under the GENERAL config

Each series spawns its own server with the appropriate `ENABLE_*`
flags, fills a fresh chat with four marker files to cross the 70% and
90% thresholds, and verifies that a marker from the old chat can be
recalled in the new one.

**Run:**

```bash
npm run test:rag
```

**Requires:** `.api-key` must exist. The port must be free — the
suite starts and stops its own server instances.

---

### 3. `selectors.test.js` — UI selector validation

**What it tests:**
- Every CSS selector in `src/browser/Selectors.ts` against the live
  DeepSeek UI
- Optional selectors are reported as warnings, not failures

**Run:**

```bash
npm run test:selectors
```

**Requires:** `state.json` (browser cookies). No API server needed.

Optional flags:

```bash
# Show the browser window (headless by default)
SELECTOR_TEST_HEADLESS=false npm run test:selectors

# Disable the on-screen overlay
SELECTOR_TEST_OVERLAY=false npm run test:selectors
```

---

### 4. `response-parser.test.js` — unit tests

**What it tests:**
- `stripMarkdownFences`, `extractBalancedJson`, `normalizeToolCall`,
  `closeBrackets`, `repairTruncatedJson`, `parseResponse`
- Covers markdown-fenced JSON, preamble, code inside string values,
  flat vs nested tool calls, truncated brackets
- Uses `tests/data/truncated-write_files.json` as a real-world fixture
- Fixture is generated programmatically from valid JSON via
  `node tests/data/make-fixture.cjs`. The script writes a valid JSON
  structure truncated by exactly two characters (the outermost `]}`),
  mimicking the observed failure mode.

**Run:**

```bash
npm run test:unit
```

**Requires:** nothing. Runs in milliseconds.

---

## Configuration

`tests/config.env`:

```ini
SERVER_URL=http://localhost:3000
TEST_DATA_DIR=./data
```

- `SERVER_URL` — base URL of the API server.
- `TEST_DATA_DIR` — path to the folder with test files (relative to
  the test script).

Do not commit API keys or real credentials. Registration uses dummy
credentials (`test@example.com` / `test`).

---

## Running tests

| Suite | Command | Requires running server |
|-------|---------|------------------------|
| Unit | `npm run test:unit` | no |
| API integration | `npm run test:api` | yes |
| Context transfer | `npm run test:rag` | no (spawns its own) |
| Selectors | `npm run test:selectors` | no (uses cookies only) |

For CI, start the server in the background first:

```bash
npm start &
sleep 30
npm run test:unit
npm run test:api
```

Any non-zero exit code indicates a test failure.

---

## Adding new tests

1. **Selectors:** update `src/browser/Selectors.ts`, then add the
   corresponding `await test(...)` call in `selectors.test.js`.
2. **API:** add test functions to `api.test.js` following the existing
   block pattern.
3. **Unit:** add functions to the module under test, then add cases to
   `response-parser.test.js`.
4. **Fixtures:** place small input files under `data/`. Use
   `data/images/` for images.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `selectors.test.js` fails | Run with `SELECTOR_TEST_HEADLESS=false` to see the browser; check which selector is missing; update `Selectors.ts`. |
| API tests fail | Ensure the server is running (`npm start`). Check `config.env` for the correct `SERVER_URL`. |
| Context-transfer tests fail to spawn a server | Another `node server.js` is still running. See "Port already in use" below. |
| Registration fails | Delete `.api-key` and `state.json` in the project root, restart the server. |
| `EADDRINUSE: address already in use :::3000` | See "Port already in use" below. |

### Port already in use

`test:api` requires the server to be running on port 3000;
`test:rag` requires the port to be **free** (it spawns its own
server). Both situations produce the same underlying error:

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Fix:**

```bash
# Find what is holding the port
lsof -i :3000

# Kill only that process (replace <PID> with the number from the output)
kill <PID>

# Or, if you know it is a stray server from a previous run:
pkill -f "node server.js"
```

**Note.** `pkill -f "node server.js"` matches any process whose command
line contains `node server.js`. On a shared machine this could kill
someone else's process. On a local development machine it is safe and
convenient. Prefer `lsof -i :3000` + `kill <PID>` when in doubt.

After killing, verify the port is free:

```bash
lsof -i :3000    # should print nothing
```