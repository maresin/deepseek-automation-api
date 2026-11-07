# Changelog

All notable changes to DeepSeek Automation API.

This file is user-facing: it tells you what changed between releases,
whether the change is breaking, and what you might need to do when
upgrading.

For internal design history (algorithm versions, rationale for each
revision) see `docs/changelog/`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0] — 2026-11-08

Consolidates CDP-mode hardening after v1.2.0. Six fixes, two
additions. Behavioural change: `detectServerBusy` is now icon-only
(no text matching in the decision).

### Added

- **`DEEPSEEK_TOOL_FORMAT`** — `auto` (default), `json`, `dsml`.
  Selects the prompt that asks the model for a tool-call format
  inside the chat (`tools_prompt.txt` or `tools_prompt_dsml.txt`).
  The API always returns standard OpenAI JSON to the client.
- **`prompts/tools_prompt_dsml.txt`** — prompt asking the model to
  use its native DSML markup. Reduces the "sometimes JSON,
  sometimes DSML" drift on tool-call requests.
- **`acquireLaunchLock`** — file lock around Chrome autolaunch.
  Two agents starting at the same instant no longer launch two
  Chrome instances.
- **`pid_is_live_agent`, `kill_pid_hard`, `kill_agent_on_port`**
  in `templates/lib/common.sh` — lifecycle helpers. Reject
  zombies and reused PIDs; escalate SIGTERM to SIGKILL; identify
  port holders by cmdline.

### Fixed

- **`syncAuthFilesFromSource` removed.** Copied Cookies from
  `~/.config/google-chrome` into the CDP profile by mtime. When
  the source had an expired Google session but a newer Cookies
  file, sync overwrote the live session in the CDP profile.
  Cloudflare challenged the fingerprint; in one reported case
  this led to a DeepSeek account ban. The CDP profile is now
  self-contained. Only `copyProfileFromDefault` remains, and it
  runs only when the target directory is empty.
- **`initFromExistingFiles` — `.api-key` alone is enough.** In
  CDP mode `state.json` is never written; the old check required
  both files and never initialised the client. Users had to
  create an empty `state.json` as a workaround.
- **`validateMessages` — `content: null` accepted.** Per OpenAI
  spec, assistant messages with `tool_calls` must have
  `content: null`. Previously a normal round-trip failed
  validation before the model saw the tool result.
- **`buildPrompt` — `Assistant: [tool calls: name]`** instead of
  `Assistant: null`. The latter confused the model on empty
  turns and could hang the tool-calling loop.
- **`parseLenientJson` — literal newlines and tabs in DSML
  parameters.** Strict JSON forbids raw newlines; model output
  often contains them inside long `script` arguments.
- **DSML diagnostics in `parseResponse`.** Logs has `<invoke>`,
  has `<parameter>`, closers, and head/tail preview. Future
  variants can be identified from the log without a debugger.
- **`detectServerBusy` — icon-only, global scan.** DeepSeek
  changes the label without notice: "Server busy", "Messages too
  frequent", "Validation failed" are the same state with different
  text. The retry icon is stable. The scan is global (the
  "Validation failed" badge appears in the input area, not in a
  rendered message).
- **`start-all.sh` — force-cleanup instead of refusing.** Leftover
  agents from a crashed or unclean shutdown are killed by PID and
  by port; stale PID files removed. A clean tree no longer blocks
  with "already running".
- **`stop-all.sh` — SIGTERM, then SIGKILL.** Escalates after 5s;
  port fallback for processes whose PID file was stale or missing.
  Foreign processes on an agent port are rejected, never killed.

### Changed

- **`detectServerBusy` no longer uses text matching in the
  decision.** Text is still captured by diagnostics, not by the
  busy path. Classic "Server busy" and "Messages too frequent"
  behave as before (icon detected); "Validation failed" is now
  detected as well.
- **`make-multi-agent.sh` in CDP mode** sets
  `DEEPSEEK_CDP_AUTOCLOSE=false`,
  `DEEPSEEK_CDP_AUTOLAUNCH=true`, and
  `DEEPSEEK_CDP_COPY_DEFAULT_PROFILE=false` in every generated
  `agent.env`. Multi-agent Chrome is a shared resource: no agent
  may kill it, and the first agent launches it if needed.
- **`DEEPSEEK_TOOL_FORMAT` propagated** from the API root `.env`
  to each generated `agent.env`.

### Documentation

- `docs/guides/building-applications.md`: CDP mode subsection
  under the multi-agent chapter.
- `docs/guides/installation.md`: Chrome setup checklist for CDP
  mode — Google account, English as preferred language, one-time
  login to chat.deepseek.com. Without these the API starts but
  DeepSeek shows verification, and text selectors fail on
  non-English UI.

### Known limitations

- Server-busy retry (5-minute backoff) has not yet fired on a real
  busy signal; icon detection is verified, the backoff path is
  not.
- `DEEPSEEK_CDP_AUTOCLOSE=true` with `AUTOLAUNCH=true` in a
  multi-agent deployment is untested (multi-agent uses `false`).
- RAG isolation across a CDP transition (snapshot + context
  overflow) has not been stress-tested.

## [1.2.0] — 2026-11-07

### Added

- **CDP mode (`DEEPSEEK_CDP_URL`).** The API connects to a
  Chrome instance the user (or a host extension) has already
  launched with `--remote-debugging-port`, instead of starting
  its own browser. This is the only mode that reliably passes
  Cloudflare Turnstile on the DeepSeek login page: every
  technique that lets Playwright *launch* Chrome leaves a
  fingerprint Cloudflare does not trust, whereas a CDP attach to
  a user-launched Chrome is indistinguishable from a normal
  DevTools session.

  Autolaunch behavior:
  - If the CDP port answers, the API uses that Chrome and never
    touches its lifecycle. This is the model for host extensions
    like Pingis that start Chrome themselves.
  - If the port is silent and `DEEPSEEK_CDP_AUTOLAUNCH=true`
    (default), the API launches Chrome with the profile from
    `DEEPSEEK_CDP_PROFILE_DIR`. On first launch, the profile is
    copied from `~/.config/google-chrome` — cookies, history,
    and `cf_clearance` come along.
  - On shutdown, the API closes Chrome only if it launched it and
    `DEEPSEEK_CDP_AUTOCLOSE` is true.

- **Multi-agent CDP (`make-multi-agent.sh --cdp-url URL`).**
  Generates a deployment where each agent connects to the same
  Chrome, in its own tab. Tabs are isolated: separate chat,
  uploads, RAG index. On stop, only the agent's tab closes;
  Chrome survives for other agents and for tab reuse.

- **Tab reuse on restart.** When an agent restarts with a
  `lastChatId` in its `chat_state.json`, it looks for an existing
  tab whose URL matches `/a/chat/s/<id>`. If found, it attaches
  to that tab and skips `restorePrevious` entirely — no sidebar
  click, no `startFresh`. Startup is 3s instead of 8–10s. Works
  after unclean shutdowns (`kill -9`), which is exactly the
  scenario where graceful restore is not available.

- **Orphaned process cleanup on startup.** Fixes two failure
  modes that left the API stuck:
  - an orphaned `node server.js` from an earlier `kill -9` of
    the npm wrapper holds the port, causing `EADDRINUSE` on the
    next start;
  - a zombie Chrome bound to the CDP port but not answering
    `/json/version`.

  The cleanup uses SIGKILL on our own orphans (not SIGTERM: an
  orphan must not run its shutdown handler, because that would
  close the Chrome needed for tab reuse). It identifies "our
  own" by cmdline (`node .../server.js`) and cwd (same
  directory or a subdirectory). A foreign process on the port —
  `python3 -m http.server`, an unrelated Node app — is refused
  with a clear error rather than killed.

- **`DEEPSEEK_BROWSER`.** Selects between bundled Chromium
  (default) and system Google Chrome in stateless mode.

### Fixed

- **`register.js` deletes `.api-key` on re-register.** The old
  check required both `state.json` and `.api-key`; in CDP mode
  `state.json` is intentionally absent, so the check always
  failed and wiped the key. Now an existing `.api-key` is
  returned as-is.

- **`init.js` refuses to initialize in CDP mode.** The startup
  check also required both files, so after a first clean
  restart the server came up with `isReady() = false` and every
  request returned 503. `.api-key` alone is now sufficient.

- **Prompt files resolved via `process.cwd()`.** The loader
  looked for `prompts/` relative to the process working
  directory, which breaks in multi-agent deployments (each
  agent runs from its own subdirectory). Resolved relative to
  `__dirname` instead, matching the pattern already used in
  `paths.ts`.

- **`~` in `DEEPSEEK_CDP_PROFILE_DIR` was not expanded.**
  `path.resolve('~/.config/...')` produced
  `<cwd>/~/.config/...`, creating the profile inside the repo
  and leaving Chrome with an empty user-data-dir. An
  `expandHome()` helper now handles `~` and `~/`.

- **`cp -a src dst` nested the profile.** When the destination
  directory already existed, `cp -a` created `dst/src` rather
  than copying contents into `dst/`. Fixed with `src/. dst/`.

- **SQLite WAL files were not synced with Cookies.** When the
  source Chrome is running, recent cookie writes may still be
  in `Cookies-wal`, not in the main db file. Both
  `-wal` and `-shm` are now copied alongside `Cookies`.

### Changed

- **`DEEPSEEK_CDP_AUTOCLOSE` default is now `true`.** Chrome
  shuts down on Ctrl+C by default — clean shutdown, good for
  host extensions that start/stop the API per task. Set to
  `false` for fast restarts with tab reuse across Ctrl+C
  cycles.

- **`playwright` and `playwright-core` kept, `patchright`
  removed.** Patchright was tried as a stealth fork to bypass
  Cloudflare and did not help; the CDP approach supersedes it.
  `playwright` remains as the CLI for `npx playwright install
  chromium`; `playwright-core` is the library import.

## [1.0.1] — 2026-10-25

### Added

- **`DEEPSEEK_BROWSER`.** Selects between bundled Chromium
  (default) and system Google Chrome. Chrome carries a different
  fingerprint and is often treated more favourably by Cloudflare
  on the DeepSeek login page — the recommended fallback when the
  bundled Chromium gets stuck in a captcha loop.

### Fixed

- **Tool calls emitted in DSML markup.** DeepSeek occasionally
  writes tool calls in an internal `<｜｜DSML｜｜ calls>` format
  instead of the JSON shape requested by the system prompt. These
  now parse into standard OpenAI `tool_calls` instead of passing
  through as plain text, which broke the client's tool-calling
  loop. Preamble text before the marker is preserved in `content`.

### Changed

- **Tool prompt: forbidden markup.** `prompts/tools_prompt.txt` now
  explicitly forbids XML, DSML, YAML, and other markup languages for
  tool calls, in addition to the existing "JSON only" rule. This
  reduces the frequency of DSML markup appearing at all; the DSML
  parser (see Fixed above) remains the safety net if it does.

## [1.0.0] — 2026-10-20

Initial public release. Everything below was developed iteratively
over the previous months; this is the first version tagged as a
stable release.

### Added

- OpenAI-compatible endpoints: `/v1/chat/completions`, `/v1/files`,
  `/v1/chat/new`, `/v1/chat/single`, `/v1/context/status`, `/health`.
- File upload: multipart (`files` field) and two-phase
  (`POST /v1/files` → `file_id` inside message content).
- Tool calling with repair of truncated / markdown-wrapped /
  preamble-wrapped JSON.
- Automatic context management: 70% / 90% thresholds, snapshot,
  transition to a new chat.
- Optional RAG over conversation history (local embeddings, linear
  JSON index, no external vector database).
- DeepThink (R1) and Web Search toggles, per request.
- Session recovery: browser cookies in `state.json`, chat state in
  `chat_state.json`.
- Selector validation at startup; server refuses to run if critical
  UI selectors are missing.
- Multi-agent deployments: `tools/make-multi-agent.sh` generates N
  agents sharing one cookie session on N ports.
- Server Busy retry: 3 attempts, 5-minute cooldown, `Retry-After`
  header on 503.
- Recovery from thinking-phase interruption ("Stopped" marker):
  one Regenerate click before giving up.

### Known limitations

- Single tenant per process. Multiple concurrent sessions require
  multiple processes.
- No streaming. Responses are returned whole.
- Browser automation depends on DeepSeek UI selectors. Breakage
  surfaces at startup (selector validation) and via
  `npm run test:selectors`.
- DeepSeek cookies expire every 1–3 months. Login must be refreshed;
  chat history and RAG indexes are preserved.
- `file_id` is single-use (differs from OpenAI semantics; deliberate).
- Invalid JSON emitted by the model in a long string value is not
  repaired (documented, by design).

### Dependencies

- Node.js 18+
- Playwright (bundled Chromium in `./browsers`)
- `@xenova/transformers` for local embeddings (only when RAG is on)

[Unreleased]: https://github.com/maresin/deepseek-automation-api/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/maresin/deepseek-automation-api/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/maresin/deepseek-automation-api/compare/v1.0.1...v1.2.0
[1.0.1]: https://github.com/maresin/deepseek-automation-api/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/maresin/deepseek-automation-api/releases/tag/v1.0.0