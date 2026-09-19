#!/usr/bin/env node
/**
 * 03 — Feature toggles.
 *
 * Covers:
 *   - extra_body.deepthink: true     → DeepThink (R1)
 *   - extra_body.web_search: true    → Web Search
 *   - both at once
 *
 * Important: toggles are PER-REQUEST.
 * If a request omits extra_body.deepthink, the server explicitly disables
 * DeepThink before sending — see server-modules/routes/chat.js. You must
 * pass the flags every time you want them on.
 *
 * Timing note: DeepThink takes significantly longer (60–120s vs 15–30s).
 * Context note: DeepThink multiplies context consumption by
 * DEEPSEEK_DEEPTHINK_MULTIPLIER (default 2.5). See algorithm C7.
 *
 * Requires Node.js 18+ (native fetch).
 */

import {
  banner, section,
  loadOrRegisterKey, sendChat, printResponse,
} from './common.js';

// ---------------------------------------------------------------------
// 1. DeepThink only
// ---------------------------------------------------------------------

async function exampleDeepThink(apiKey) {
  section('Example 1: DeepThink');

  const messages = [{
    role: 'user',
    content: 'Explain quantum entanglement in simple terms.',
  }];
  const data = await sendChat(apiKey, messages, { extra_body: { deepthink: true } });
  printResponse(data);
}

// ---------------------------------------------------------------------
// 2. Web Search only
// ---------------------------------------------------------------------

async function exampleWebSearch(apiKey) {
  section('Example 2: Web Search');

  const messages = [{
    role: 'user',
    content: 'What are the latest developments in AI?',
  }];
  const data = await sendChat(apiKey, messages, { extra_body: { web_search: true } });
  printResponse(data);
}

// ---------------------------------------------------------------------
// 3. Both
// ---------------------------------------------------------------------

async function exampleBoth(apiKey) {
  section('Example 3: DeepThink + Web Search');

  const messages = [{
    role: 'user',
    content: 'Compare the latest AI regulation proposals in the EU and the US.',
  }];
  const data = await sendChat(apiKey, messages, {
    extra_body: { deepthink: true, web_search: true },
  });
  printResponse(data);
}

// ---------------------------------------------------------------------
// 4. Reset — toggles do not persist
// ---------------------------------------------------------------------

async function exampleReset(apiKey) {
  section('Example 4: reset (no extra_body)');

  const messages = [{ role: 'user', content: 'What is 2 + 2?' }];
  const data = await sendChat(apiKey, messages);
  printResponse(data);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  banner('03 — Feature toggles');
  const apiKey = await loadOrRegisterKey();

  await exampleDeepThink(apiKey);
  await exampleWebSearch(apiKey);
  await exampleBoth(apiKey);
  await exampleReset(apiKey);

  banner('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});