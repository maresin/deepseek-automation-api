#!/usr/bin/env node
/**
 * 04 — File uploads.
 *
 * Covers:
 *   - POST /v1/files                            → upload, get file_id
 *   - POST /v1/chat/completions (JSON)          → use file_id in messages
 *   - POST /v1/chat/completions (multipart)     → attach file(s) directly
 *   - Mixed content                             → text + file in one message
 *
 * Two ways to attach a file:
 *   A. Upload first via /v1/files, then reference file_id in a normal
 *      JSON request.
 *   B. Attach directly with multipart/form-data — no prior upload.
 *
 * IMPORTANT — file_id is single-use in this implementation.
 * After a chat request that references a file_id, the file is deleted
 * from disk (or handed to the RAG indexing queue and deleted later).
 * The next request with the same file_id returns 400. To reuse, upload
 * again.
 *
 * Limits: 100 MB per file, 50 files per request.
 *
 * Requires Node.js 18+ (native fetch, FormData, Blob).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASE_URL, banner, section,
  loadOrRegisterKey, printResponse,
} from './common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(__dirname, 'test_files');

// ---------------------------------------------------------------------
// Test files
// ---------------------------------------------------------------------

async function prepareTestFiles() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });

  await fs.writeFile(path.join(TEST_DIR, 'notes.txt'),
    'Project notes\n' +
    '-------------\n' +
    'Goal: automate DeepSeek Web via Playwright.\n' +
    'Status: selectors verified, context management done.\n' +
    'Next: finalize documentation.\n'
  );

  await fs.writeFile(path.join(TEST_DIR, 'requirements.md'),
    '# Requirements\n\n' +
    '- Node.js 18+\n' +
    '- fetch\n' +
    '- Server running at localhost:3000\n'
  );

  await fs.writeFile(path.join(TEST_DIR, 'questions.txt'),
    '1. When will the next release be?\n' +
    '2. What are the open issues?\n' +
    '3. Who is the maintainer?\n'
  );
}

async function cleanupTestFiles() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------

async function uploadFile(apiKey, filePath) {
  const content = await fs.readFile(filePath);
  const name = path.basename(filePath);

  const form = new FormData();
  form.append('file', new Blob([content]), name);

  // Do NOT set Content-Type: fetch will add it with the boundary.
  const r = await fetch(`${BASE_URL}/v1/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!r.ok) {
    console.error(`✗ Upload failed: HTTP ${r.status} — ${await r.text()}`);
    process.exit(1);
  }

  return r.json();
}

// ---------------------------------------------------------------------
// Multipart chat
// ---------------------------------------------------------------------

async function sendChatMultipart(apiKey, messages, filePaths) {
  const form = new FormData();
  for (const p of filePaths) {
    const content = await fs.readFile(p);
    form.append('files', new Blob([content]), path.basename(p));
  }
  form.append('data', JSON.stringify({ messages }));

  const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!r.ok) {
    console.error(`✗ HTTP ${r.status}: ${await r.text()}`);
    process.exit(1);
  }

  return r.json();
}

// ---------------------------------------------------------------------
// JSON chat (for file_id references)
// ---------------------------------------------------------------------

async function sendChatJson(apiKey, messages) {
  const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });

  if (!r.ok) {
    console.error(`✗ HTTP ${r.status}: ${await r.text()}`);
    process.exit(1);
  }

  return r.json();
}

// ---------------------------------------------------------------------
// 1. Upload via /v1/files and use file_id
// ---------------------------------------------------------------------

async function exampleFileId(apiKey) {
  section('Example 1: upload via /v1/files, use file_id');

  const fileObj = await uploadFile(apiKey, path.join(TEST_DIR, 'notes.txt'));
  const fileId = fileObj.id;
  console.log(`✓ Uploaded: ${fileObj.filename} (${fileObj.bytes} bytes)`);
  console.log(`  file_id: ${fileId}`);

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'Summarize this in one sentence.' },
      { type: 'file', file: { file_id: fileId } },
    ],
  }];
  const data = await sendChatJson(apiKey, messages);
  printResponse(data);
}

// ---------------------------------------------------------------------
// 2. Multipart, single file
// ---------------------------------------------------------------------

async function exampleMultipartSingle(apiKey) {
  section('Example 2: multipart, single file');

  const messages = [{
    role: 'user',
    content: 'What are the three questions in the attached file?',
  }];
  const data = await sendChatMultipart(apiKey, messages, [
    path.join(TEST_DIR, 'questions.txt'),
  ]);
  printResponse(data);
}

// ---------------------------------------------------------------------
// 3. Multipart, multiple files
// ---------------------------------------------------------------------

async function exampleMultipartMultiple(apiKey) {
  section('Example 3: multipart, multiple files');

  const messages = [{
    role: 'user',
    content: 'Compare these files and list what they have in common.',
  }];
  const paths = [
    path.join(TEST_DIR, 'notes.txt'),
    path.join(TEST_DIR, 'requirements.md'),
    path.join(TEST_DIR, 'questions.txt'),
  ];
  const data = await sendChatMultipart(apiKey, messages, paths);
  printResponse(data);
}

// ---------------------------------------------------------------------
// 4. Mixed: text + file_id in the same message
// ---------------------------------------------------------------------

async function exampleMixed(apiKey) {
  section('Example 4: mixed content (text + file_id)');

  const fileObj = await uploadFile(apiKey, path.join(TEST_DIR, 'requirements.md'));
  const fileId = fileObj.id;
  console.log(`✓ Uploaded: ${fileObj.filename}  file_id: ${fileId}`);

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'Look at the requirements. What Node.js version is needed?' },
      { type: 'file', file: { file_id: fileId } },
    ],
  }];
  const data = await sendChatJson(apiKey, messages);
  printResponse(data);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  banner('04 — File uploads');
  await prepareTestFiles();

  try {
    const apiKey = await loadOrRegisterKey();
    await exampleFileId(apiKey);
    await exampleMultipartSingle(apiKey);
    await exampleMultipartMultiple(apiKey);
    await exampleMixed(apiKey);
  } finally {
    await cleanupTestFiles();
  }

  banner('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});