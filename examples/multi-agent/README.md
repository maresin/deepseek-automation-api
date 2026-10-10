# Multi-agent deployment example

Two DeepSeek agents, one account, one login, no captcha.

    agent-a (PORT 3000) ──┐
                          ├── shared-state.json  (DeepSeek cookies)
    agent-b (PORT 3001) ──┘

Each agent has its own chat, its own context counter, its own uploads,
and its own RAG index. They only share the browser cookies, which
means the login and the Cloudflare captcha happen exactly once — in a
normal browser, not in the automated one.

## What's here

| File | Purpose |
|---|---|
| `env.a.example` | Environment for agent A |
| `env.b.example` | Environment for agent B |
| `start-all.sh` | Start both agents (Linux / macOS / Git Bash) |
| `start-all.ps1` | Start both agents (Windows PowerShell) |
| `stop-all.sh` | Stop both agents (Linux / macOS / Git Bash) |
| `stop-all.ps1` | Stop both agents (Windows PowerShell) |
| `demo_client.py` | A working two-agent pipeline |
| `cookies-to-state.py` | Convert Cookie-Editor JSON → Playwright storageState |

## Prerequisites

1. A working `.env` in the project root with a registered session,
   or a `state.json` produced by any prior successful login.
2. `jq` — for the cookie-transfer path.
   - Linux: `apt install jq` / `dnf install jq`
   - macOS: `brew install jq`
   - Windows: `choco install jq` or from https://stedolan.github.io/jq/
3. Python 3.8+ with `requests` (only for `demo_client.py`).

## Step 1. Get a working state.json

**If you already have a working `.env` setup**, just copy its state:

```bash
cp ../../state.json ./shared-state.json
```

**If not**, use the cookie-transfer method. This is the recommended
path and avoids the captcha entirely.

### 1a. Log in to chat.deepseek.com in Firefox

Use a normal browser. Chrome works too, but Firefox is currently more
trusted by Cloudflare's fingerprinting heuristics.

### 1b. Export cookies as JSON

Install the **Cookie-Editor** extension. Open it on
`chat.deepseek.com`, click **Export → JSON**, save to
`/tmp/cookies.json`.

### 1c. Convert

```bash
python cookies-to-state.py /tmp/cookies.json shared-state.json
chmod 600 shared-state.json
```

The script converts the Cookie-Editor format into Playwright's
`storageState`. Verify:

```bash
jq '.cookies | length' shared-state.json
jq '.cookies[].name' shared-state.json
```

You should see **more than 3 cookies**, including `cf_clearance` —
that is the Cloudflare pass token. If it is absent, the transfer will
not work: go back and log in to DeepSeek again in Firefox, then
re-export.

## Step 2. Configure the two agents

```bash
cp env.a.example .env.a
cp env.b.example .env.b
```

Edit both files if needed. The defaults work as-is, provided
`shared-state.json` is in this directory.

**Critical:** `DEEPSEEK_STATE_PATH` is the same in both files. Every
other path is unique. Do not mix them up.

## Step 3. Create the API keys

Each agent needs its own Bearer token. Pick arbitrary strings — these
are passwords to *your own* proxy, not to DeepSeek:

```bash
echo "deepseek_agent_a_$(openssl rand -hex 8)" > .api-key-a
echo "deepseek_agent_b_$(openssl rand -hex 8)" > .api-key-b
chmod 600 .api-key-a .api-key-b
```

Or let the server generate them: start each agent once with
`ENABLE_RESTORE=false`, hit `POST /v1/register`, and the server will
write `.api-key-a` / `.api-key-b` automatically. Cookies are already
present, so `/v1/register` will not trigger a login.

## Step 4. Start both agents

**Linux / macOS / Git Bash:**

```bash
./start-all.sh
```

**Windows PowerShell:**

```powershell
.\start-all.ps1
```

The script starts both processes in the background, waits for their
health endpoints, and writes `agent-a.pid` / `agent-b.pid`.

Expected output (abbreviated):

```
→ Starting agent A (PORT=3000)...
→ Starting agent B (PORT=3001)...
→ Waiting for agent A...✓
→ Waiting for agent B...✓
Both agents are running.
  A: http://localhost:3000
  B: http://localhost:3001
Logs: agent-a.log, agent-b.log
```

**Do not panic if you see:**

```
💾 Skipping state write: file is newer (mtime ... > ...)
```

in `agent-b.log`. That is the mtime-guard working as designed: agent A
wrote the state, agent B correctly refused to overwrite it with an
older snapshot. See `docs/algorithms/session.md#a6`.

## Step 5. Verify

```bash
./verify.sh
```

Or manually:

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health

# Each agent accepts only its own key
curl http://localhost:3000/v1/context/status \
  -H "Authorization: Bearer $(cat .api-key-a)"

# This must return {"error":"Invalid API key"}
curl http://localhost:3000/v1/context/status \
  -H "Authorization: Bearer $(cat .api-key-b)"

# Chats must have different IDs
jq '.deepseek.lastChatId' chat_state-a.json
jq '.deepseek.lastChatId' chat_state-b.json
```

## Step 6. Run the demo client

```bash
pip install requests
python demo_client.py
```

The client asks agent A a question, sends the answer to agent B for
critique, and returns the revision. Both agents work in parallel — the
total wall time is roughly one round-trip, not two.

## Step 7. Stop

**Linux / macOS / Git Bash:**

```bash
./stop-all.sh
```

**Windows PowerShell:**

```powershell
.\stop-all.ps1
```

Or kill by port:

```bash
npx kill-port 3000 3001
```

## Files produced at runtime

```
shared-state.json      ← cookie session (do not commit, do not delete lightly)
chat_state-a.json      ← agent A's chat state
chat_state-b.json      ← agent B's chat state
.api-key-a             ← agent A's Bearer token
.api-key-b             ← agent B's Bearer token
uploads-a/             ← agent A's temporary files
uploads-b/             ← agent B's temporary files
rag_data-a/            ← agent A's RAG index
rag_data-b/            ← agent B's RAG index
agent-a.log            ← stdout of agent A
agent-b.log            ← stdout of agent B
agent-a.pid            ← PID file (Linux/macOS)
agent-b.pid
```

Add all of these to `.gitignore` if this directory is versioned.

## When cookies expire

DeepSeek cookies live 1–3 months. Symptoms:

- `📌 On login page, attempting auto-login...` in the log
- `❌ Chat page did not load (mainTextarea not visible)`
- Any 4xx from DeepSeek on a chat request

Fix: repeat Step 1 (`cookies-to-state.py`), restart both agents. Chat
history and RAG indexes are untouched.

## Troubleshooting

**`EADDRINUSE: address already in use :::3000`** — something else is
on the port.

```bash
npx kill-port 3000 3001
```

**Both agents log `💾 State saved`** — the startup windows did not
overlap, so no guard triggered. Harmless. The state is the same on both
sides (same cookies).

**One agent logs `Performing auto-login`** — cookies are not being
picked up. Check that `shared-state.json` is at the path in
`DEEPSEEK_STATE_PATH`, and that both agents point to the same file.

**`cf_clearance` is missing from shared-state.json`** — the cookie
export did not capture the Cloudflare pass. Log in to DeepSeek in
Firefox again, verify the chat interface loads (not a challenge page),
then re-export.

**The captcha appears anyway** — the automated browser was already
flagged. See the escalation ladder in
`docs/guides/building-applications.md#капча-эскалационная-лестница`.

Full discussion:
[`docs/guides/building-applications.md`](../../docs/guides/building-applications.md).