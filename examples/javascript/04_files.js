/**
 * 04 — File uploads.
 *
 * Two ways to attach a file:
 *
 *   A. Multipart form — attach the file directly to the chat request.
 *      No prior upload. Simplest path.
 *
 *   B. Two-phase — upload via POST /v1/files, get a file_id, then
 *      reference it inside the messages content array. Mirrors the
 *      OpenAI Assistants flow.
 *
 *     node 04_files.js
 *
 * IMPORTANT — file_id is single-use in this implementation. After the
 * request that references it, the file is deleted from disk (or handed
 * to the RAG indexing queue and deleted later). The next request with
 * the same file_id returns 400. To reuse, upload again.
 *
 * Supported extensions: PDF, DOC(X), XLS(X), PPT(X), images, plain text,
 * source code, JSON, YAML, HTML, CSS. Limits: 100 MB per file, 50 files
 * per request.
 */

import fs from 'node:fs/promises';

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'deepseek_...'; // replace

// ─────────────────────────────────────────────────────────────────────
// Prepare test files
// ─────────────────────────────────────────────────────────────────────

await fs.writeFile('/tmp/notes.txt',
  'Project notes\n' +
  '-------------\n' +
  'Goal: automate DeepSeek Web via Playwright.\n' +
  'Marker: NOTES42.\n'
);

await fs.writeFile('/tmp/second.txt', 'Second file. Marker: SECOND99.\n');

// ─────────────────────────────────────────────────────────────────────
// 1. Multipart — single file, no prior upload
// ─────────────────────────────────────────────────────────────────────
//
// Send the file directly in the chat request using multipart/form-data.
// The file goes into the `files` field; the JSON payload goes into
// the `data` field.
//
// The server forwards the file to DeepSeek's UI. No file_id involved.

{
  const form = new FormData();
  const content = await fs.readFile('/tmp/notes.txt');
  form.append('files', new Blob([content]), 'notes.txt');
  form.append('data', JSON.stringify({
    messages: [{ role: 'user', content: 'What is the marker in this file?' }],
  }));

  // Do NOT set Content-Type — fetch adds the boundary automatically.
  const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: form,
  });

  const data = await r.json();
  console.log(data.choices[0].message.content);
  // → The marker is NOTES42.
}

// ─────────────────────────────────────────────────────────────────────
// 2. Multipart — multiple files (up to 50)
// ─────────────────────────────────────────────────────────────────────
//
// Repeat the `files` field for each file. Order is preserved.
// The server validates each file's extension and size individually.

{
  const form = new FormData();
  for (const path of ['/tmp/notes.txt', '/tmp/second.txt']) {
    const content = await fs.readFile(path);
    form.append('files', new Blob([content]), path.split('/').pop());
  }
  form.append('data', JSON.stringify({
    messages: [{ role: 'user', content: 'List the markers from both files.' }],
  }));

  const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: form,
  });

  const data = await r.json();
  console.log(data.choices[0].message.content);
  // → NOTES42 and SECOND99.
}

// ─────────────────────────────────────────────────────────────────────
// 3. Two-phase — upload first, get a file_id
// ─────────────────────────────────────────────────────────────────────
//
// OpenAI-compatible endpoint. Returns a file object:
//
//   {
//     "id": "file_1789891863600_abc12345",
//     "object": "file",
//     "bytes": 68,
//     "created_at": 1789891863,
//     "filename": "notes.txt",
//     "purpose": "assistants"
//   }
//
// The `id` can be referenced later inside a message's content array.

const fileId = await (async () => {
  const content = await fs.readFile('/tmp/notes.txt');
  const form = new FormData();
  form.append('file', new Blob([content]), 'notes.txt');

  const r = await fetch(`${BASE_URL}/v1/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: form,
  });

  const obj = await r.json();
  console.log(obj);
  return obj.id;
})();

// ─────────────────────────────────────────────────────────────────────
// 4. Use file_id in a JSON chat request
// ─────────────────────────────────────────────────────────────────────
//
// Reference the file via the content array — same shape as OpenAI.
// A message can mix text and file parts in any order.

{
  const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is the marker in this file?' },
          { type: 'file', file: { file_id: fileId } },
        ],
      }],
    }),
  });

  const data = await r.json();
  console.log(data.choices[0].message.content);
}

// After this request, the file_id is dead. Reusing it returns:
//   400 { "error": "File not found for file_id: file_..." }
// To attach the same file again, upload it again.