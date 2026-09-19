#!/usr/bin/env node
/**
 * 05 — Session management and error handling.
 *
 * The most important example. The first four are optimistic: they assume
 * the session never overflows and the network is reliable. Real usage is
 * different.
 *
 * Covers:
 *   - Monitoring context_status on every response
 *   - HTTP 409 (context_exhausted) → /v1/chat/new → retry
 *   - HTTP 503 (server_busy)       → save state, wait for restart
 *   - HTTP 401 (invalid_key)       → re-register
 *   - HTTP 504 (timeout)           → retry with backoff
 *   - /v1/chat/new {restore: true/false}
 *   - /v1/context/status
 *   - /v1/chat/single  (temporary chat)
 *
 * See docs/guides/session-management.md for the full discussion.
 *
 * Requires Node.js 18+ (native fetch, FormData, Blob).
 */

import {
  BASE_URL, banner, section,
  loadOrRegisterKey, printContextStatus,
} from './common.js';

// =====================================================================
// Core: send a message with full error handling
// =====================================================================

class SessionLost extends Error {}

export async function sendMessage(apiKey, messages, options = {}) {
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
            'Authorization': `Bearer ${apiKey}`,
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
        console.error(`✗ Timeout after ${maxRetries} attempts. Giving up.`);
        throw new SessionLost('timeout');
      }
      console.error(`⏱ Timeout on attempt ${attempt}/${maxRetries}. Retry in ${backoff}ms...`);
      await sleep(backoff);
      backoff *= 2;
      continue;
    }

    // ---- 200 ----
    if (r.status === 200) {
      const data = await r.json();
      printContextStatus(data);
      return data;
    }

    // ---- 400 validation ----
    if (r.status === 400) {
      console.error(`✗ Validation error: ${await r.text()}`);
      throw new SessionLost('validation_error');
    }

    // ---- 401 invalid key ----
    if (r.status === 401) {
      console.error('✗ Invalid API key. Re-register via /v1/register.');
      throw new SessionLost('invalid_key');
    }

    // ---- 409 context exhausted ----
    if (r.status === 409) {
      const body = await r.json();
      const err = body.error || {};
      console.error(
        `⚠ Context exhausted: ${err.chars_used} / ${err.chars_limit} chars`
      );
      console.error(`  DeepSeek readable: ${err.deepseek_readable_percent}%`);
      console.error(`  RAG preserved: ${err.rag_enabled}`);
      console.error(`  Recovery: ${err.recovery}`);

      await startNewChat(apiKey, /* restore */ false);

      // Retry the original request in the new chat. Do not count this
      // attempt: the previous one did not count either.
      attempt--;
      continue;
    }

    // ---- 503 server busy ----
    if (r.status === 503) {
      console.error('🚫 DeepSeek server busy.');
      console.error(
        '  The server will shut down in ~500 ms by design. ' +
        'Wait for an external supervisor to restart it.'
      );
      throw new SessionLost('server_busy');
    }

    // ---- 504 timeout ----
    if (r.status === 504) {
      if (attempt > maxRetries) {
        console.error(`✗ Timeout after ${maxRetries} attempts. Giving up.`);
        throw new SessionLost('timeout');
      }
      console.error(`⏱ 504 on attempt ${attempt}/${maxRetries}. Retry in ${backoff}ms...`);
      await sleep(backoff);
      backoff *= 2;
      continue;
    }

    // ---- Anything else ----
    console.error(`✗ Unexpected HTTP ${r.status}: ${await r.text()}`);
    throw new SessionLost(`http_${r.status}`);
  }
}

// =====================================================================
// Session helpers
// =====================================================================

async function startNewChat(apiKey, restore) {
  const r = await fetch(`${BASE_URL}/v1/chat/new`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ restore }),
  });

  if (r.status === 200) {
    console.log(`  → New chat (${restore ? 'restore' : 'fresh'}).`);
    return;
  }

  if (r.status === 409) {
    const body = await r.json();
    const err = body.error || {};
    console.error(`  ⚠ Restore failed: ${err.reason}`);
    console.error(`    ${err.message}`);
    console.error(`    state_cleared: ${err.state_cleared}`);
    // Fall back to fresh.
    await startNewChat(apiKey, false);
    return;
  }

  console.error(`  ✗ /v1/chat/new failed: HTTP ${r.status}`);
}

async function getContextStatus(apiKey) {
  const r = await fetch(`${BASE_URL}/v1/context/status`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!r.ok) throw new Error(`context/status HTTP ${r.status}`);
  return r.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================================
// 1. Monitor context_status
// =====================================================================

async function exampleMonitor(apiKey) {
  section('Example 1: monitor context_status');

  const before = await getContextStatus(apiKey);
  console.log(`  before: ${before.totalChars.toLocaleString()} / ${before.maxChars.toLocaleString()} (${before.percent}%)`);

  await sendMessage(apiKey, [{ role: 'user', content: 'Say one word: OK.' }]);

  const after = await getContextStatus(apiKey);
  console.log(`  after:  ${after.totalChars.toLocaleString()} / ${after.maxChars.toLocaleString()} (${after.percent}%)`);
}

// =====================================================================
// 2. Simulating a 409
// =====================================================================

async function exampleHandle409(apiKey) {
  section('Example 2: recover after context exhaustion');

  console.log('  Forcing a fresh chat (as if 409 had just been returned)...');
  await startNewChat(apiKey, false);

  await sendMessage(apiKey, [
    { role: 'user', content: 'We started over. Acknowledge.' },
  ]);
}

// =====================================================================
// 3. Restore vs fresh
// =====================================================================

async function exampleRestoreVsFresh(apiKey) {
  section('Example 3: restore vs fresh');

  console.log('  → fresh chat');
  await startNewChat(apiKey, false);
  await sendMessage(apiKey, [{ role: 'user', content: 'Say: fresh.' }]);

  console.log('\n  → restore last chat');
  await startNewChat(apiKey, true);
  await sendMessage(apiKey, [{ role: 'user', content: 'Say: restored.' }]);
}

// =====================================================================
// 4. Degradation of quality
// =====================================================================

async function exampleGracefulDegradation(apiKey) {
  section('Example 4: degradation and the system message');

  const system =
    'Context that must survive any transition:\n' +
    '  Project: DeepSeek Automation API.\n' +
    '  Maintainer: Alice.\n' +
    '  Deadline: 2026-10-01.\n' +
    'Refer to these facts in every answer.';

  await startNewChat(apiKey, false);

  const data = await sendMessage(apiKey, [
    { role: 'system', content: system },
    { role: 'user',   content: 'Who is the maintainer?' },
  ]);
  const answer = data.choices[0].message.content || '';
  console.log(`  Answer includes 'Alice'? ${answer.includes('Alice')}`);
}

// =====================================================================
// 5. Temporary chat (/v1/chat/single)
// =====================================================================

async function exampleSingle(apiKey) {
  section('Example 5: temporary chat (/v1/chat/single)');

  const messagesJson = '[{"role":"user","content":"Answer briefly: what is 2+2?"}]';

  const form = new FormData();
  form.append('messages', messagesJson);

  const r = await fetch(`${BASE_URL}/v1/chat/single`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!r.ok) {
    console.error(`✗ HTTP ${r.status}: ${await r.text()}`);
    return;
  }

  const data = await r.json();
  console.log(`✓ ${(data.answer || '').slice(0, 120)}`);
  console.log(`  inserted into main context: ${data.inserted}`);
}

// =====================================================================
// Main
// =====================================================================

async function main() {
  banner('05 — Session management and error handling');
  const apiKey = await loadOrRegisterKey();

  try {
    await exampleMonitor(apiKey);
    await exampleHandle409(apiKey);
    await exampleRestoreVsFresh(apiKey);
    await exampleGracefulDegradation(apiKey);
    await exampleSingle(apiKey);
  } catch (e) {
    if (e instanceof SessionLost) {
      console.error(`\n✗ Session lost: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  banner('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});