#!/usr/bin/env node
/**
 * 01 — Getting started.
 *
 * Covers:
 *   - GET  /health
 *   - POST /v1/register           (create a session, via common helper)
 *   - POST /v1/chat/completions   (single user message)
 *
 * The API key is saved to .examples-api-key and reused by all
 * subsequent examples.
 *
 * Requires Node.js 18+ (native fetch).
 */

import {
  BASE_URL, banner,
  loadOrRegisterKey, sendChat, printResponse,
} from './common.js';

// ---------------------------------------------------------------------
// 1. Health check
// ---------------------------------------------------------------------

async function checkHealth() {
  let r;
  try {
    r = await fetch(`${BASE_URL}/health`);
  } catch (e) {
    console.error(`✗ Server unreachable: ${e.message}`);
    console.error('  Start it with: npm start');
    process.exit(1);
  }

  if (!r.ok) {
    console.error(`✗ Health check failed: HTTP ${r.status}`);
    process.exit(1);
  }

  const { status } = await r.json();
  console.log(`✓ Health: ${status}`);
}

// ---------------------------------------------------------------------
// 2. Registration
// ---------------------------------------------------------------------

// Covered by loadOrRegisterKey() from common.js.
// If you need to force a new session, delete .examples-api-key and rerun.

// ---------------------------------------------------------------------
// 3. Basic chat
// ---------------------------------------------------------------------

async function basicChat(apiKey) {
  console.log('\n→ Sending a single user message...');

  const messages = [{ role: 'user', content: "Say 'Hello, API!'" }];
  const data = await sendChat(apiKey, messages);
  printResponse(data);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  banner('01 — Getting started');

  await checkHealth();
  const apiKey = await loadOrRegisterKey();
  await basicChat(apiKey);

  banner('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});