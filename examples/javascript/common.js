/**
 * Shared helpers for all JavaScript examples.
 *
 * Usage:
 *   import {
 *     BASE_URL, loadOrRegisterKey,
 *     sendChat, printResponse, printContextStatus,
 *   } from './common.js';
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'http://localhost:3000';
export const KEY_FILE = path.join(__dirname, '.examples-api-key');

// ---------------------------------------------------------------------
// Session / API key
// ---------------------------------------------------------------------

export async function loadOrRegisterKey() {
  try {
    const key = (await fs.readFile(KEY_FILE, 'utf-8')).trim();
    if (key) {
      console.log(`✓ Loaded existing API key: ${key.slice(0, 24)}...`);
      return key;
    }
  } catch { /* file missing */ }

  console.log('→ No saved key. Registering a new session...');
  const email = process.env.DEEPSEEK_EMAIL || 'your@email.com';
  const password = process.env.DEEPSEEK_PASSWORD || 'your_password';

  const r = await fetch(`${BASE_URL}/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!r.ok) {
    console.error(`✗ Registration failed: ${r.status}`);
    console.error(await r.text());
    process.exit(1);
  }

  const { api_key } = await r.json();
  await fs.writeFile(KEY_FILE, api_key);
  console.log(`✓ New API key: ${api_key.slice(0, 24)}... (saved to ${path.basename(KEY_FILE)})`);
  return api_key;
}

// ---------------------------------------------------------------------
// Chat request
// ---------------------------------------------------------------------

export async function sendChat(apiKey, messages, options = {}) {
  const { tools, extra_body, timeoutMs = 180_000 } = options;

  const payload = { messages };
  if (tools !== undefined) payload.tools = tools;
  if (extra_body !== undefined) payload.extra_body = extra_body;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let r;
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

  if (!r.ok) {
    console.error(`✗ HTTP ${r.status}: ${await r.text()}`);
    process.exit(1);
  }

  return r.json();
}

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

export function printResponse(data) {
  const message = data.choices[0].message;

  if (message.tool_calls?.length) {
    console.log('✓ Tool call(s) detected:');
    for (const tc of message.tool_calls) {
      console.log(`   ${tc.function.name}(${tc.function.arguments})`);
    }
  } else {
    console.log(`✓ ${message.content}`);
  }

  printContextStatus(data);
}

export function printContextStatus(data) {
  const status = data.context_status;
  if (!status) return;

  const { chars_used, chars_limit, percent_used, warning, recommendation } = status;
  console.log(`   context: ${chars_used.toLocaleString()} / ${chars_limit.toLocaleString()} chars (${percent_used}%)`);

  if (warning) {
    console.log(`   ⚠ warning: ${warning} → ${recommendation}`);
  }

  const dll = status.deepseek_length_limit || {};
  if (dll.detected) {
    console.log(`   🚫 DeepSeek read only ${dll.readable_percent}%`);
  }
}

// ---------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------

export function banner(title) {
  console.log('='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

export function section(title) {
  console.log('\n' + '-'.repeat(60));
  console.log(title);
  console.log('-'.repeat(60));
}