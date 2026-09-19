# Tests for DeepSeek Automation API

This directory contains all tests for the DeepSeek Automation API project.

## Structure

```
tests/
├── README.md                          # This file
├── config.env                         # Test configuration (SERVER_URL, TEST_DATA_DIR)
├── data/                              # Test data files
│   └── images/                        # Image files for upload tests
│       └── lenna.png                  # Standard test image
├── reports/                           # Test reports (generated automatically)
├── selector-tests/
│   └── selector-browser-test.js       # Browser-based selector validation (Playwright)
└── api-tests/
    ├── api-integration-node.js        # API integration tests
    └── api-integration-rag.js         # Context-transfer tests (snapshot / RAG)
```

---

## Test types

### 1. Selector tests

**What it does:**
- Launches Chromium via Playwright.
- Navigates to the DeepSeek web interface.
- Validates every CSS selector used in the automation.
- Displays a visual overlay with test progress.

**Why it's needed:**
- Ensures UI selectors are still valid after DeepSeek updates.
- Must be run after any change to `Selectors.ts` or after a DeepSeek UI change.

**Run:**
```bash
npm run test:selectors
```

Independent from the API server. Requires only `state.json` (browser cookies).

---

### 2. API integration tests

**What they test:**
- Registration (`/v1/register`)
- Session state (`/v1/chat/new`, `chat_state.json`)
- Basic chat completion (`/v1/chat/completions`)
- DeepThink and Web Search toggles
- Tool calling (function calling)
- File upload (single, multiple, image, `file_id` reference)
- Request validation (401, 400 for various malformed inputs)
- Context status (`/v1/context/status`)
- Temporary chat (`/v1/chat/single`) with `return_only` and `insert_to_context`

**Run:**
```bash
npm run test:api
```

Requires a running server (`npm start`).

---

### 3. RAG / snapshot context-transfer tests

**What they test:**
- Snapshot-cycle behavior: `snapshot70Done`, `snapshot90Done`,
  `snapshot.txt` creation and cleanup.
- RAG-cycle behavior: `ragSearchActive` activation, index cleanup.
- Actual context transfer across a chat transition (marker-file recall).
- State persistence across server restarts.
- Near-limit file handling under the GENERAL config (no snapshot, no RAG).

Each series spawns its own server with the appropriate `ENABLE_*` flags,
fills a fresh chat with four marker files to cross the 70% and 90%
thresholds, and verifies that a marker from the old chat can be recalled
in the new one.

**Run:**
```bash
npm run test:rag
```

Requires a registered session (`.api-key` must exist) and no other server
instance on the configured port.

---

## Configuration

`tests/config.env`:

```ini
SERVER_URL=http://localhost:3000
TEST_DATA_DIR=./data
```

- `SERVER_URL` — base URL of the API server.
- `TEST_DATA_DIR` — path to the folder with test files (relative to the test script).

Do not commit API keys or real credentials. Registration uses dummy
credentials (`test@example.com` / `test`).

---

## Running tests

| Suite | Command | Requires running server |
|-------|---------|------------------------|
| Selectors | `npm run test:selectors` | no |
| API integration | `npm run test:api` | yes |
| Context transfer | `npm run test:rag` | no (spawns its own) |

For CI, start the server in the background first:

```bash
npm start &
sleep 30
npm run test:api
```

Any non-zero exit code indicates a test failure.

---

## Adding new tests

1. **Selectors:** update `src/browser/Selectors.ts`, then add the
   corresponding `await test(...)` call in `selector-browser-test.js`.
2. **API:** add test functions to `api-integration-node.js` following the
   existing block pattern.
3. **Data files:** place new fixtures under `data/`.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `selector-browser-test.js` fails | Run with `SELECTOR_TEST_HEADLESS=false` to see the browser; check which selector is missing; update `Selectors.ts`. |
| API tests fail | Ensure the server is running (`npm start`). Check `config.env` for the correct `SERVER_URL`. |
| RAG tests fail to spawn a server | Another `node server.js` is still running. See "Port already in use" below. |
| Registration fails | Delete `.api-key` and `state.json` in the project root, restart the server. |
| `EADDRINUSE: address already in use :::3000` | See "Port already in use" below. |

### Port already in use

The most common problem. `test:api` requires the server to be running on
port 3000; `test:rag` requires the port to be **free** (it spawns its own
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