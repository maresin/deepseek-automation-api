/**
 * 05 — Session management and error handling.
 *
 * The other examples assume the session never overflows and the network
 * is reliable. Real usage is different.
 *
 * Two independent limits
 * ──────────────────────
 *   context_status.chars_limit           — our estimate:
 *                                           1_000_000 tokens × language_coefficient
 *   context_status.deepseek_length_      — the real limit DeepSeek actually read
 *     limit.readable_percent               (appears only when the banner fires)
 *
 * The estimate is intentionally the EARLIER of the two. Transitions are
 * triggered by the estimate; the real banner is an emergency path.
 *
 * Graceful degradation
 * ────────────────────
 * When a chat reaches the limit, the server transitions to a NEW chat.
 * Snapshot and RAG transfer only a fraction of the old context. Even with
 * both enabled, the model treats the transferred content as a DOCUMENT,
 * not as its own memory. Quality drops after every transition.
 *
 * Client responsibilities
 * ───────────────────────
 *   1. Inspect context_status on EVERY successful response.
 *   2. Log warning changes: null → context_above_70 → context_near_limit.
 *   3. On 409 context_exhausted: call /v1/chat/new, retry.
 *   4. On 503 server_busy: do NOT retry — the server is shutting down.
 *   5. On 401 invalid_key: re-register via /v1/register.
 *   6. On 504 timeout: retry with exponential backoff.
 *   7. Keep critical facts in the system message — not in messages[].
 *
 *     node 05_session.js
 *
 * Full protocol: docs/guides/session-management.md
 */

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'deepseek_...'; // replace

// ─────────────────────────────────────────────────────────────────────
// The core: chat() with full error handling
// ─────────────────────────────────────────────────────────────────────
//
// One function, because retry logic must live somewhere. Everything
// else in this file is either documentation or a demo call.

async function chat(messages, options = {}) {
  const { extra_body, maxRetries = 3, timeoutMs = 300_000 } = options;
  const payload = { messages };
  if (extra_body) payload.extra_body = extra_body;

  let attempt = 0;
  let backoff = 1000;

  while (true) {
    attempt++;

    let r;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        r = await fetch(`${BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      // Client-side timeout / network error — treat like 504.
      if (attempt > maxRetries) {
        throw new Error(`Timeout after ${maxRetries} attempts.`);
      }
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff *= 2;
      continue;
    }

    // ─── 200 OK ────────────────────────────────────────────
    if (r.status === 200) {
      const data = await r.json();
      printContextStatus(data);
      return data;
    }

    // ─── 400 Validation error ──────────────────────────────
    // Bad messages, bad tools, bad extra_body. Retrying will not
    // help — the request itself is malformed.
    if (r.status === 400) {
      throw new Error(`Validation error: ${await r.text()}`);
    }

    // ─── 401 Invalid key ───────────────────────────────────
    // The key does not match the server's .api-key. Re-register.
    if (r.status === 401) {
      throw new Error('Invalid API key. Call /v1/register.');
    }

    // ─── 409 Context exhausted ─────────────────────────────
    // The current chat is full. Start a new one, retry the same
    // request. The retry does NOT count as a new attempt — the
    // previous request was valid, it just hit the limit.
    if (r.status === 409) {
      const body = await r.json();
      const err = body.error || {};
      console.error(
        `⚠ Context exhausted: ${err.chars_used} / ${err.chars_limit} chars`
      );
      console.error(`  DeepSeek readable: ${err.deepseek_readable_percent}%`);
      console.error(`  RAG preserved: ${err.rag_enabled}`);

      await newChat(false);
      attempt--; // do not count this as a retry
      continue;
    }

    // ─── 503 Server busy ───────────────────────────────────
    // DeepSeek backend refusing. The server shuts down by design
    // after responding. Retrying is pointless for hours.
    if (r.status === 503) {
      throw new Error('Server busy. Wait for restart.');
    }

    // ─── 504 Timeout ───────────────────────────────────────
    if (r.status === 504) {
      if (attempt > maxRetries) {
        throw new Error(`Timeout after ${maxRetries} attempts.`);
      }
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff *= 2;
      continue;
    }

    // ─── Anything else ─────────────────────────────────────
    throw new Error(`Unexpected HTTP ${r.status}: ${await r.text()}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Session helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /v1/chat/new.
 *
 * restore=false — fresh chat, RAG index cleared. Use after 409.
 * restore=true  — reopen the last chat, RAG index preserved.
 */
async function newChat(restore = false) {
  const r = await fetch(`${BASE_URL}/v1/chat/new`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ restore }),
  });

  if (r.status === 200) {
    console.log(`  → New chat (${restore ? 'restore' : 'fresh'}).`);
  } else if (r.status === 409) {
    const body = await r.json();
    const err = body.error || {};
    console.error(`  ⚠ Restore failed: ${err.reason} — falling back to fresh.`);
    await newChat(false);
  } else {
    console.error(`  ✗ /v1/chat/new failed: HTTP ${r.status}`);
  }
}

/** GET /v1/context/status — cheap health check. */
async function contextStatus() {
  const r = await fetch(`${BASE_URL}/v1/context/status`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  return r.json();
}

/** Print the context_status block from a chat response. */
function printContextStatus(data) {
  const status = data.context_status;
  if (!status) return;
  console.log(
    `  context: ${status.chars_used.toLocaleString()} / ` +
    `${status.chars_limit.toLocaleString()} chars ` +
    `(${status.percent_used}%)`
  );
  if (status.warning) {
    console.log(`  ⚠ ${status.warning} → ${status.recommendation}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Demo
// ─────────────────────────────────────────────────────────────────────

// Baseline: where are we?
console.log('Before:', await contextStatus());
// → { totalChars: 0, maxChars: 2400000, percent: 0, ... }

// A normal request. chat() handles the happy path and prints
// context_status for you.
await chat([{ role: 'user', content: 'Say one word: ready.' }]);
// → context: 28 / 2,400,000 chars (0%)

// Force a fresh chat, as if a 409 had just been returned. In a real
// client this happens automatically inside chat() — the call here is
// only so the demo shows the flow.
await newChat(false);

// Send the same request in the new chat. It should succeed.
await chat([{ role: 'user', content: 'Say one word: fresh.' }]);

// ─────────────────────────────────────────────────────────────────────
// A note on the system message
// ─────────────────────────────────────────────────────────────────────
//
// After a transition, the model does NOT remember everything. Even
// with both Snapshot and RAG enabled, it treats the transferred
// content as a document.
//
// The system message is different: it is resent on every request and
// survives every transition. Put facts that must persist there, not
// in the conversation history.

await chat([
  {
    role: 'system',
    content:
      'Reference facts for this session:\n' +
      '  Maintainer: Alice\n' +
      '  Deadline: 2026-10-01\n' +
      'Refer to these in every answer.',
  },
  { role: 'user', content: 'Who is the maintainer?' },
]);
// The answer includes "Alice" — the system message survives any chat
// switch.
//
// Full protocol: docs/guides/session-management.md