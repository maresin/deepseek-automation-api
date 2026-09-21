#!/usr/bin/env node
/**
 * @file tests/api-tests/api-integration-node.js
 * Integration tests for DeepSeek Automation API (Node.js).
 *
 * Runs against an already-running server. Does not spawn its own process.
 * For restart / restore / RAG-transition scenarios, see api-integration-rag.js.
 *
 * Every assistant reply is validated by content — an expected marker, a
 * known fact, or a specific keyword — never by length alone.
 *
 * Run: node tests/api-tests/api-integration-node.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CHAT_STATE_FILE = path.join(PROJECT_ROOT, 'chat_state.json');
const TMP_DIR = path.join(__dirname, 'tmp');

// ============================================================
// CONFIGURATION
// ============================================================

const configPath = path.join(__dirname, 'config.env');
const config = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf-8')
        .split('\n')
        .filter(line => line && !line.startsWith('#'))
        .reduce((acc, line) => {
            const [key, value] = line.split('=');
            acc[key.trim()] = value.trim();
            return acc;
        }, {})
    : {};

const SERVER_URL = config.SERVER_URL || 'http://localhost:3000';
const TEST_DATA_DIR = path.join(__dirname, config.TEST_DATA_DIR || './data');

let API_KEY = null;
let TOTAL = 0;
let FAILURES = 0;

// ============================================================
// LOGGING
// ============================================================

function logBlock(name) {
    console.log('\n═══════════════════════════════════════');
    console.log(`📌 ${name}`);
    console.log('═══════════════════════════════════════');
}

function logResult(test, passed, details = '') {
    TOTAL++;
    if (!passed) FAILURES++;
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${test}${details ? ' — ' + details : ''}`);
}

// ============================================================
// HELPERS
// ============================================================

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, data, text };
}

function getResponseContent(data) {
    if (!data || !data.choices || !data.choices[0]) return '';
    return data.choices[0].message?.content || '';
}

function readChatState() {
    if (!fs.existsSync(CHAT_STATE_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(CHAT_STATE_FILE, 'utf-8')).deepseek || null;
    } catch {
        return null;
    }
}

function ensureTmp() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function cleanupTmp() {
    if (fs.existsSync(TMP_DIR)) {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
}

// ============================================================
// TEST FILE GENERATORS
// ============================================================

/**
 * Build a text file with a unique marker, a topic, and four facts,
 * followed by a body of readable prose that repeats the facts in
 * different phrasings. The body gives the model (and any snapshot)
 * something meaningful to summarize; the marker provides a
 * deterministic check.
 *
 * @returns {{ marker: string, size: number }}
 */
function makeMarkerFile(filePath, markerName, topic, facts, approxChars) {
    const marker = `${markerName}_${Date.now()}`;
    const header = [
        `UNIQUE_MARKER: ${marker}`,
        `TOPIC: ${topic}`,
        ...facts.map((f, i) => `FACT_${i + 1}: ${f}`),
        '',
    ].join('\n');

    const paragraphs = [`This document is about ${topic}.`];
    for (const fact of facts) {
        paragraphs.push(fact);
        paragraphs.push(`It is important to remember that ${fact.toLowerCase()}`);
    }
    let body = paragraphs.join(' ');
    while (body.length < approxChars - header.length) {
        body += ' ' + body;
    }
    body = body.substring(0, Math.max(0, approxChars - header.length));

    fs.writeFileSync(filePath, header + body);
    return { marker, size: (header + body).length };
}

function createSvgWithText(filePath, text) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
  <rect width="600" height="200" fill="white"/>
  <text x="30" y="125" font-family="monospace" font-size="80" font-weight="bold" fill="black">${text}</text>
</svg>`;
    fs.writeFileSync(filePath, svg);
}

function createFakeExeFile(filePath) {
    const bytes = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    fs.writeFileSync(filePath, bytes);
}

function createEmptyFile(filePath) {
    fs.writeFileSync(filePath, '');
}

// ============================================================
// API ACTIONS
// ============================================================

async function getApiKey() {
    if (API_KEY) return API_KEY;
    const { ok, data, text } = await fetchJSON(`${SERVER_URL}/v1/register`, {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'test' }),
    });
    if (!ok) throw new Error(`Registration failed: ${text}`);
    API_KEY = data.api_key;
    console.log(`🔑 API key: ${API_KEY}`);
    return API_KEY;
}

async function newChat(restore = false) {
    return await fetchJSON(`${SERVER_URL}/v1/chat/new`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ restore }),
    });
}

async function chat(messages, extra_body = {}, tools = null) {
    const body = { messages, extra_body };
    if (tools) body.tools = tools;
    return await fetchJSON(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
    });
}

async function uploadFilesMultipart(filePaths, query) {
    const form = new FormData();
    for (const fp of filePaths) {
        form.append('files', new Blob([fs.readFileSync(fp)]), path.basename(fp));
    }
    form.append('data', JSON.stringify({
        messages: [{ role: 'user', content: query }],
        extra_body: {},
    }));
    const res = await fetch(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: form,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, data, text };
}

async function uploadFileOpenAI(filePath) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    form.append('purpose', 'assistants');
    const res = await fetch(`${SERVER_URL}/v1/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: form,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, data, text };
}

async function chatWithFileId(fileId, query) {
    return await chat([{
        role: 'user',
        content: [
            { type: 'file', file: { file_id: fileId } },
            { type: 'text', text: query },
        ],
    }]);
}

async function contextStatus() {
    return await fetchJSON(`${SERVER_URL}/v1/context/status`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
    });
}

async function single(messages, options = {}) {
    return await fetchJSON(`${SERVER_URL}/v1/chat/single`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ messages, ...options }),
    });
}

// ============================================================
// MAIN
// ============================================================

async function runTests() {
    console.log('🚀 API integration tests (Node.js)');
    console.log(`🔗 ${SERVER_URL}`);
    console.log(`📂 ${TEST_DATA_DIR}\n`);

    ensureTmp();

    // ============================================================
    // BLOCK A — SESSION & STATE
    // ============================================================
    logBlock('BLOCK A: Session & state');

    console.log('\n[A.1] Registration');
    await getApiKey();
    logResult('API key obtained', !!API_KEY, API_KEY);

    console.log('\n[A.2] New chat (fresh)');
    const a2 = await newChat(false);
    logResult('newChat responded', a2.ok && a2.data?.success === true);
    const s2 = readChatState();
    logResult('chatStarted = false', s2?.chatStarted === false);
    logResult('ragSearchActive = false', s2?.ragSearchActive === false);
    logResult('snapshot70Done = false', s2?.snapshot70Done === false);
    logResult('snapshot90Done = false', s2?.snapshot90Done === false);

    console.log('\n[A.3] Restore without saved chat → 409 no_last_chat_id');
    const a3 = await newChat(true);
    logResult('Returns 409', a3.status === 409, `status=${a3.status}`);
    logResult('reason = no_last_chat_id',
        a3.data?.error?.reason === 'no_last_chat_id',
        `reason=${a3.data?.error?.reason}`);

    // Prepare a clean chat for the next blocks
    await newChat(false);

    // ============================================================
    // BLOCK B — CHAT BASICS
    // ============================================================
    logBlock('BLOCK B: Chat basics');

    const CODE_B1 = `TEAL${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    console.log('\n[B.1] Marker code challenge');
    const b1 = await chat([{
        role: 'user',
        content: `Remember this code: ${CODE_B1}. Reply only with the word OK.`,
    }]);
    const b1Text = getResponseContent(b1.data);
    logResult('B.1 responded', b1.ok && b1Text.length > 0, `${b1Text.length} chars`);
    logResult('B.1 acknowledges', /ok/i.test(b1Text), `answer: "${b1Text.substring(0, 80)}"`);

    console.log('\n[B.2] Recall marker code (same chat)');
    const b2 = await chat([{
        role: 'user',
        content: 'What code did I ask you to remember? Reply with the code only.',
    }]);
    const b2Text = getResponseContent(b2.data);
    logResult('B.2 responded', b2.ok && b2Text.length > 0);
    logResult('B.2 recalls code', b2Text.includes(CODE_B1),
        `expected ${CODE_B1}, got "${b2Text.substring(0, 100)}"`);

    console.log('\n[B.3] DeepThink with distinct marker');
    const CODE_B3 = `DEEP${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const b3 = await chat(
        [{ role: 'user', content: `Think carefully. What is 17 * 4? Reply with the result and mention the tag ${CODE_B3}.` }],
        { deepthink: true }
    );
    const b3Text = getResponseContent(b3.data);
    logResult('B.3 responded', b3.ok && b3Text.length > 0);
    logResult('B.3 correct result (68)', b3Text.includes('68'), `answer: "${b3Text.substring(0, 120)}"`);
    logResult('B.3 tag preserved', b3Text.includes(CODE_B3));

    console.log('\n[B.4] Web Search');
    const b4 = await chat(
        [{ role: 'user', content: 'What is the current calendar year? Reply with the four-digit year only.' }],
        { web_search: true }
    );
    const b4Text = getResponseContent(b4.data);
    logResult('B.4 responded', b4.ok && b4Text.length > 0);
    logResult('B.4 contains a plausible year', /\b(202[4-9]|203\d)\b/.test(b4Text),
        `answer: "${b4Text.substring(0, 80)}"`);

    console.log('\n[B.5] Multi-role conversation');
    const b5 = await chat([
        { role: 'system', content: 'You are a concise assistant. Answer in one sentence.' },
        { role: 'user', content: 'What is the capital of France?' },
        { role: 'assistant', content: 'The capital of France is Paris.' },
        { role: 'user', content: 'Which famous museum is located there? Name it.' },
    ]);
    const b5Text = getResponseContent(b5.data).toLowerCase();
    logResult('B.5 responded', b5.ok && b5Text.length > 0);
    logResult('B.5 mentions Louvre', b5Text.includes('louvre'), `answer: "${b5Text.substring(0, 100)}"`);

    console.log('\n[B.6] Tool calling (argument check)');
    const tools = [{
        type: 'function',
        function: {
            name: 'get_weather',
            description: 'Get current weather for a city',
            parameters: {
                type: 'object',
                properties: { location: { type: 'string' } },
                required: ['location'],
            },
        },
    }];
    const b6 = await chat(
        [{ role: 'user', content: 'Use the get_weather tool to fetch the current weather in Paris.' }],
        {},
        tools
    );
    const tc = b6.data?.choices?.[0]?.message?.tool_calls;
    logResult('B.6 tool_calls present', Array.isArray(tc) && tc.length > 0,
        Array.isArray(tc) ? `${tc.length} call(s)` : 'none');
    if (Array.isArray(tc) && tc.length > 0) {
        const fn = tc[0].function?.name;
        const args = tc[0].function?.arguments || '';
        logResult('B.6 function name is get_weather', fn === 'get_weather', `fn=${fn}`);
        logResult('B.6 arguments mention Paris', /paris/i.test(args), `args=${args.substring(0, 80)}`);
    } else {
        logResult('B.6 function name is get_weather', false, 'no tool_calls');
        logResult('B.6 arguments mention Paris', false, 'no tool_calls');
    }

    console.log('\n[B.7] Complex tool schema (array of objects)');
    const b7Tools = [{
        type: 'function',
        function: {
            name: 'write_files',
            description: 'Write an array of files',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string' },
                                content: { type: 'string' },
                            },
                            required: ['path', 'content'],
                        },
                    },
                },
                required: ['files'],
            },
        },
    }];
    const b7 = await chat(
        [{ role: 'user', content: 'Write two files: a.txt with "hello" and b.txt with "world".' }],
        {},
        b7Tools
    );
    const b7Choice = b7.data?.choices?.[0];
    const b7Msg = b7Choice?.message;
    const b7Tc = b7Msg?.tool_calls;

    logResult('B.7 tool_calls present',
        Array.isArray(b7Tc) && b7Tc.length > 0,
        Array.isArray(b7Tc) ? `${b7Tc.length} call(s)` : 'none');
    logResult('B.7 content is null',
        b7Msg?.content === null,
        `content=${JSON.stringify(b7Msg?.content)?.substring(0, 40)}`);
    logResult('B.7 finish_reason = tool_calls',
        b7Choice?.finish_reason === 'tool_calls',
        `finish_reason=${b7Choice?.finish_reason}`);

    if (Array.isArray(b7Tc) && b7Tc.length > 0) {
        const fn = b7Tc[0].function;
        logResult('B.7 function.name = write_files',
            fn?.name === 'write_files',
            `name=${fn?.name}`);
        logResult('B.7 arguments is a JSON string',
            typeof fn?.arguments === 'string',
            `typeof=${typeof fn?.arguments}`);

        try {
            const args = JSON.parse(fn.arguments);
            logResult('B.7 arguments.files is a non-empty array',
                Array.isArray(args.files) && args.files.length >= 1,
                `files.length=${args.files?.length}`);
            logResult('B.7 files[0] has path and content',
                typeof args.files?.[0]?.path === 'string' &&
                typeof args.files?.[0]?.content === 'string',
                `path=${args.files?.[0]?.path}, content=${args.files?.[0]?.content}`);
        } catch (e) {
            logResult('B.7 arguments parses as JSON', false, e.message);
        }
    }

    // ============================================================
    // BLOCK C — FILES
    // ============================================================
    logBlock('BLOCK C: Files');

    console.log('\n[C.1] Single text file with a unique marker');
    const fileRome = path.join(TMP_DIR, 'rome.txt');
    const romeInfo = makeMarkerFile(
        fileRome,
        'ROME',
        'History of Rome',
        [
            'The Aqua Virgo aqueduct was completed in 19 BC.',
            'The Colosseum could hold between 50,000 and 80,000 spectators.',
            'The Western Roman Empire fell in 476 AD.',
            'The Roman Empire reached its greatest territorial extent under Trajan in 117 AD.',
        ],
        13000
    );
    console.log(`   Marker: ${romeInfo.marker} (${romeInfo.size} chars)`);
    const c1 = await uploadFilesMultipart([fileRome],
        'Reply with the UNIQUE_MARKER line from this file verbatim. Nothing else.');
    const c1Text = getResponseContent(c1.data);
    logResult('C.1 responded', c1.ok && c1Text.length > 0);
    logResult('C.1 marker echoed', c1Text.includes(romeInfo.marker),
        `expected ${romeInfo.marker}`);

    console.log('\n[C.2] Multiple text files with distinct markers');
    const fileJapan = path.join(TMP_DIR, 'japan.txt');
    const japanInfo = makeMarkerFile(
        fileJapan,
        'JAPAN',
        'Geography of Japan',
        [
            'Mount Fuji is the highest mountain in Japan at 3,776 meters.',
            'The Japanese archipelago consists of four main islands.',
            'Tokyo is the capital and most populous city of Japan.',
            'The Sea of Japan separates Japan from the Asian mainland.',
        ],
        13000
    );
    console.log(`   Marker: ${japanInfo.marker} (${japanInfo.size} chars)`);
    const c2 = await uploadFilesMultipart([fileRome, fileJapan],
        'List the UNIQUE_MARKER values from both files. Reply with the two markers.');
    const c2Text = getResponseContent(c2.data);
    logResult('C.2 responded', c2.ok && c2Text.length > 0);
    logResult('C.2 contains ROME marker', c2Text.includes(romeInfo.marker));
    logResult('C.2 contains JAPAN marker', c2Text.includes(japanInfo.marker));

    console.log('\n[C.3] SVG image with visible text');
    const svgPath = path.join(TMP_DIR, 'secret.svg');
    createSvgWithText(svgPath, 'SECRET42');
    const c3 = await uploadFilesMultipart([svgPath],
        'What text is displayed in the image? Reply with the text only.');
    const c3Text = getResponseContent(c3.data);
    logResult('C.3 responded', c3.ok && c3Text.length > 0);
    logResult('C.3 reads SECRET42', c3Text.toUpperCase().includes('SECRET42'),
        `answer: "${c3Text.substring(0, 120)}"`);

    console.log('\n[C.4] PNG image (lenna.png) — soft check');
    const pngPath = path.join(TEST_DATA_DIR, 'images', 'lenna.png');
    if (fs.existsSync(pngPath)) {
        const c4 = await uploadFilesMultipart([pngPath],
            'Briefly describe the person shown in this image.');
        const c4Text = getResponseContent(c4.data).toLowerCase();
        logResult('C.4 responded', c4.ok && c4Text.length > 0);
        logResult('C.4 mentions a person or portrait',
            /\b(woman|portrait|person|face|lenna|lady|female|girl)\b/.test(c4Text),
            `answer: "${c4Text.substring(0, 100)}"`);
    } else {
        logResult('C.4 responded', false, 'lenna.png not found');
    }

    console.log('\n[C.5] OpenAI /v1/files + chat with file_id');
    const fileQuantum = path.join(TMP_DIR, 'quantum.txt');
    const quantumInfo = makeMarkerFile(
        fileQuantum,
        'QUANTUM',
        'Quantum Mechanics',
        [
            'The Schrödinger equation describes how the quantum state of a physical system changes over time.',
            'Quantum entanglement links the states of two or more particles.',
            'The uncertainty principle was formulated by Werner Heisenberg in 1927.',
            'Wave-particle duality is demonstrated by the double-slit experiment.',
        ],
        6000
    );
    const upRes = await uploadFileOpenAI(fileQuantum);
    const fileId = upRes.data?.id;
    logResult('C.5 file uploaded', upRes.ok && !!fileId, `file_id=${fileId}`);
    if (fileId) {
        const chatRes = await chatWithFileId(fileId,
            'Reply with the UNIQUE_MARKER line from this file verbatim. Nothing else.');
        const chatText = getResponseContent(chatRes.data);
        logResult('C.5 chat responded', chatRes.ok && chatText.length > 0);
        logResult('C.5 marker echoed via file_id', chatText.includes(quantumInfo.marker),
            `expected ${quantumInfo.marker}`);
    }

    console.log('\n[C.6] Fake .exe → 400');
    const exePath = path.join(TMP_DIR, 'fake.exe');
    createFakeExeFile(exePath);
    const c6 = await uploadFilesMultipart([exePath], 'What is in this file?');
    logResult('C.6 returns 400', c6.status === 400, `status=${c6.status}`);
    logResult('C.6 error mentions unsupported',
        typeof c6.data?.error === 'string' && c6.data.error.toLowerCase().includes('unsupported'),
        c6.data?.error || 'no error');

    console.log('\n[C.7] Empty .txt → 400');
    const emptyPath = path.join(TMP_DIR, 'empty.txt');
    createEmptyFile(emptyPath);
    const c7 = await uploadFilesMultipart([emptyPath], 'What is in this file?');
    logResult('C.7 returns 400', c7.status === 400, `status=${c7.status}`);
    logResult('C.7 error mentions empty',
        typeof c7.data?.error === 'string' && c7.data.error.toLowerCase().includes('empty'),
        c7.data?.error || 'no error');

    // ============================================================
    // BLOCK D — REQUEST VALIDATION
    // ============================================================
    logBlock('BLOCK D: Request validation');

    console.log('\n[D.1] No Authorization header → 401');
    const d1 = await fetch(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
    });
    logResult('D.1 returns 401', d1.status === 401, `status=${d1.status}`);

    console.log('\n[D.2] Invalid API key → 401');
    const d2 = await fetch(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid_key' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
    });
    logResult('D.2 returns 401', d2.status === 401, `status=${d2.status}`);

    console.log('\n[D.3] Invalid JSON in multipart data → 400');
    const badJson = new FormData();
    badJson.append('files', new Blob([Buffer.from('x')]), 'test.txt');
    badJson.append('data', 'not-json{{{');
    const d3 = await fetch(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: badJson,
    });
    logResult('D.3 returns 400', d3.status === 400, `status=${d3.status}`);

    console.log('\n[D.4] Empty messages array → 400');
    const d4 = await chat([]);
    logResult('D.4 returns 400', d4.status === 400, `status=${d4.status}`);

    console.log('\n[D.5] Invalid role → 400');
    const d5 = await chat([{ role: 'admin', content: 'test' }]);
    logResult('D.5 returns 400', d5.status === 400, `status=${d5.status}`);

    console.log('\n[D.6] messages is not an array → 400');
    const d6 = await fetchJSON(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ messages: 'not an array' }),
    });
    logResult('D.6 returns 400', d6.status === 400, `status=${d6.status}`);

    console.log('\n[D.7] tools is not an array → 400');
    const d7 = await fetchJSON(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], tools: 'not-array' }),
    });
    logResult('D.7 returns 400', d7.status === 400, `status=${d7.status}`);

    console.log('\n[D.8] extra_body is not an object → 400');
    const d8 = await fetchJSON(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], extra_body: 'string' }),
    });
    logResult('D.8 returns 400', d8.status === 400, `status=${d8.status}`);

    console.log('\n[D.9] tools with invalid structure → 400');
    const d9 = await fetchJSON(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
            messages: [{ role: 'user', content: 'x' }],
            tools: [{ type: 'invalid' }],
        }),
    });
    logResult('D.9 returns 400', d9.status === 400, `status=${d9.status}`);

    console.log('\n[D.10] Nonexistent file_id → 400');
    const d10 = await chatWithFileId('file_nonexistent_999', 'What is in this file?');
    logResult('D.10 returns 400', d10.status === 400, `status=${d10.status}`);
    logResult('D.10 error mentions not found',
        typeof d10.data?.error === 'string' && d10.data.error.toLowerCase().includes('not found'),
        d10.data?.error || 'no error');

    // ============================================================
    // BLOCK E — CONTEXT STATUS
    // ============================================================
    logBlock('BLOCK E: Context status');

    console.log('\n[E.1] /v1/context/status fields');
    const e1 = await contextStatus();
    logResult('E.1 responded', e1.ok, `status=${e1.status}`);
    const requiredFields = ['totalChars', 'maxChars', 'percent', 'snapshot70Done', 'snapshot90Done'];
    for (const field of requiredFields) {
        logResult(`E.1 field present: ${field}`,
            field in (e1.data || {}),
            `value=${JSON.stringify(e1.data?.[field])}`);
    }
    logResult('E.1 flags are boolean',
        typeof e1.data?.snapshot70Done === 'boolean' &&
        typeof e1.data?.snapshot90Done === 'boolean');

    console.log('\n[E.2] context_status inside chat/completions response');
    const e2 = await chat([{ role: 'user', content: 'Say the single word: ready.' }]);
    logResult('E.2 responded', e2.ok);
    const cs = e2.data?.context_status;
    logResult('E.2 context_status present', !!cs);
    if (cs) {
        logResult('E.2 chars_used is number', typeof cs.chars_used === 'number');
        logResult('E.2 chars_limit is number', typeof cs.chars_limit === 'number');
        logResult('E.2 percent_used is number', typeof cs.percent_used === 'number');
        logResult('E.2 language_mix present', typeof cs.language_mix === 'object');
        logResult('E.2 deepseek_length_limit present', typeof cs.deepseek_length_limit === 'object');
        const latinShare = cs.language_mix?.latin || 0;
        logResult('E.2 Latin detected as dominant', latinShare > 0.5,
            `latin=${(latinShare * 100).toFixed(1)}%`);
    }

    // ============================================================
    // BLOCK F — /v1/chat/single
    // ============================================================
    logBlock('BLOCK F: /v1/chat/single');

    console.log('\n[F.1] return_only mode');
    const f1 = await single(
        [{ role: 'user', content: 'Reply with the word PONG and nothing else.' }],
        { return_only: true }
    );
    logResult('F.1 responded', f1.ok, `status=${f1.status}`);
    logResult('F.1 has answer field', typeof f1.data?.answer === 'string');
    logResult('F.1 answer contains PONG',
        (f1.data?.answer || '').toUpperCase().includes('PONG'),
        `answer: "${(f1.data?.answer || '').substring(0, 80)}"`);

    console.log('\n[F.2] insert_to_context mode');
    const f2 = await single(
        [{ role: 'user', content: 'Reply with the code INSERTOK and nothing else.' }],
        { insert_to_context: true }
    );
    logResult('F.2 responded', f2.ok, `status=${f2.status}`);
    logResult('F.2 inserted = true', f2.data?.inserted === true, `inserted=${f2.data?.inserted}`);

    console.log('\n[F.3] Temporary chat does not overwrite the main chat');
    const sBeforeF3 = readChatState();
    const f3 = await single(
        [{ role: 'user', content: 'Say TEMP and nothing else.' }],
        { return_only: true }
    );
    logResult('F.3 responded', f3.ok);
    const sAfterF3 = readChatState();
    logResult('F.3 lastChatId unchanged',
        sBeforeF3?.lastChatId === sAfterF3?.lastChatId,
        `before=${sBeforeF3?.lastChatId}, after=${sAfterF3?.lastChatId}`);

    // ============================================================
    // BLOCK G — FINAL STATE
    // ============================================================
    logBlock('BLOCK G: Final state');

    console.log('\n[G.1] chat_state.json fields');
    const finalState = readChatState();
    const requiredStateFields = [
        'lastChatId', 'chatStarted', 'totalChars',
        'ragSearchActive', 'snapshot70Done', 'snapshot90Done',
    ];
    for (const field of requiredStateFields) {
        logResult(`G.1 field present: ${field}`,
            field in (finalState || {}),
            `value=${JSON.stringify(finalState?.[field])}`);
    }
    logResult('G.1 chatStarted = true', finalState?.chatStarted === true);
    logResult('G.1 totalChars > 0', (finalState?.totalChars || 0) > 0,
        `totalChars=${finalState?.totalChars}`);

    console.log('\n[G.2] Server still responsive after all tests');
    const g2 = await contextStatus();
    logResult('G.2 context/status OK', g2.ok, `status=${g2.status}`);

    // ============================================================
    // CLEANUP & SUMMARY
    // ============================================================
    cleanupTmp();

    console.log('\n═══════════════════════════════════════');
    console.log(`📊 Summary: ${TOTAL - FAILURES}/${TOTAL} passed, ${FAILURES} failed`);
    console.log('═══════════════════════════════════════');

    if (FAILURES > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('❌ Test error:', err);
    cleanupTmp();
    process.exit(1);
});