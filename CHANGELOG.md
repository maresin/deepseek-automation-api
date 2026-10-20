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

[Unreleased]: https://github.com/maresin/deepseek-automation-api/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/maresin/deepseek-automation-api/releases/tag/v1.0.0
