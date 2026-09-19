#!/usr/bin/env node
/**
 * 02 — Conversation patterns.
 *
 * Covers:
 *   - system + user (buildPrompt adds role prefixes)
 *   - multi-turn with assistant history
 *   - tool calling (function calling)
 *
 * Requires Node.js 18+ (native fetch).
 */

import {
  banner, section,
  loadOrRegisterKey, sendChat, printResponse,
} from './common.js';

// ---------------------------------------------------------------------
// 1. system + user
// ---------------------------------------------------------------------

async function exampleSystemUser(apiKey) {
  section('Example 1: system + user');

  const messages = [
    { role: 'system', content: 'You are an assistant that speaks like a pirate.' },
    { role: 'user',   content: 'Tell me a short joke.' },
  ];
  const data = await sendChat(apiKey, messages);
  printResponse(data);
}

// ---------------------------------------------------------------------
// 2. Multi-turn
// ---------------------------------------------------------------------

async function exampleMultiTurn(apiKey) {
  section('Example 2: multi-turn');

  const messages = [
    { role: 'user',      content: 'What is the capital of France?' },
    { role: 'assistant', content: 'The capital of France is Paris.' },
    { role: 'user',      content: 'What is the most famous museum there?' },
  ];
  const data = await sendChat(apiKey, messages);
  printResponse(data);
}

// ---------------------------------------------------------------------
// 3. Tool calling
// ---------------------------------------------------------------------

async function exampleToolCalling(apiKey) {
  section('Example 3: tool calling');

  const tools = [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['location'],
      },
    },
  }];

  const messages = [
    { role: 'user', content: 'What is the weather in Moscow?' },
  ];
  const data = await sendChat(apiKey, messages, { tools });
  printResponse(data);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  banner('02 — Conversation patterns');
  const apiKey = await loadOrRegisterKey();
  await exampleSystemUser(apiKey);
  await exampleMultiTurn(apiKey);
  await exampleToolCalling(apiKey);
  banner('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});