#!/usr/bin/env node
/**
 * @file tests/api-tests/api-integration-rag.js
 *
 * Context-transfer integration tests: two independent series, one for
 * snapshot-only configuration and one for RAG-only configuration.
 *
 * Each series:
 *   1. Spawns the server with the appropriate ENABLE_* flags.
 *   2. Fills a fresh chat with four marker files to cross both thresholds.
 *   3. Sends a trivial message → handleOverflow transfers context into a
 *      new chat.
 *   4. Asks about a marker uploaded in the old chat. The only source of
 *      that marker in the new chat is the mechanism under test — the
 *      snapshot file in the snapshot series, the RAG context file in the
 *      RAG series. A correct answer therefore proves the mechanism works.
 *   5. Restarts the server, verifies state persistence, and asks about
 *      a second marker.
 *
 * The question phrasing is identical in both series: no reference to
 * "earlier" or "attached file". The surrounding system instruction
 * (snapshot_upload_prompt.txt or rag_upload_prompt.txt) teaches the model
 * to treat any attached file as an authoritative source.
 *
 * Series are isolated: ENABLE_SNAPSHOT and ENABLE_RAG are never both true
 * in the same series. This is what makes the test conclusive.
 *
 * The RAG series cleans rag_data/ before starting, so the index contains
 * only the data produced by the current run.
 *
 * Prerequisites:
 *   - A registered session (.api-key must exist)
 *   - No other server instance running on PORT
 *
 * Run: node tests/api-tests/api-integration-rag.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const API_KEY_FILE = path.join(PROJECT_ROOT, '.api-key');
const CHAT_STATE_FILE = path.join(PROJECT_ROOT, 'chat_state.json');
const SNAPSHOT_FILE = path.join(PROJECT_ROOT, 'uploads', 'snapshot.txt');
const RAG_DATA_DIR = path.join(PROJECT_ROOT, 'rag_data');
const TMP_DIR = path.join(__dirname, '..', 'tmp');
const CONTEXT_LIMIT = '50000';

let SERVER_PROC = null;
let API_KEY = null;
let TOTAL = 0;
let FAILURES = 0;

// ============================================================
// LOGGING
// ============================================================

function logPhase(name) {
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// SERVER LIFECYCLE
// ============================================================

function spawnServer(envOverrides = {}) {
    const keys = Object.keys(envOverrides);
    const summary = keys.length ? keys.map(k => `${k}=${envOverrides[k]}`).join(', ') : 'defaults';
    console.log(`\n🔄 Spawning server (${summary})`);

    const proc = spawn('node', ['server.js'], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, ...envOverrides },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[srv-err] ${d}`));
    return proc;
}

async function waitForHealth(maxWaitMs = 300000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        try {
            const r = await fetch(`${SERVER_URL}/health`);
            if (r.ok) return true;
        } catch { /* not yet */ }
        await sleep(2000);
    }
    return false;
}

async function waitForClientReady(maxWaitMs = 300000) {
    if (!API_KEY) {
        if (!fs.existsSync(API_KEY_FILE)) {
            throw new Error('.api-key not found — run the base test first');
        }
        API_KEY = fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
    }
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        try {
            const r = await fetch(`${SERVER_URL}/v1/context/status`, {
                headers: { Authorization: `Bearer ${API_KEY}` },
            });
            if (r.status === 200) return true;
        } catch { /* not yet */ }
        await sleep(3000);
    }
    return false;
}

async function stopServer() {
    if (!SERVER_PROC) return;
    console.log('\n🛑 Stopping server...');
    const proc = SERVER_PROC;
    SERVER_PROC = null;
    await new Promise((resolve) => {
        let done = false;
        proc.once('exit', () => { if (!done) { done = true; resolve(); } });
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => {
            if (!done) {
                try { proc.kill('SIGKILL'); } catch { /* ignore */ }
                done = true;
                resolve();
            }
        }, 15000);
    });
    await sleep(3000);
}

async function startServerAndWait(envOverrides = {}) {
    SERVER_PROC = spawnServer(envOverrides);
    if (!await waitForHealth()) throw new Error('Server did not become healthy');
    if (!await waitForClientReady()) throw new Error('Client did not become ready');
}

// ============================================================
// FILE HELPERS
// ============================================================

function ensureTmp() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function cleanupTmp() {
    if (fs.existsSync(TMP_DIR)) {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
}

function snapshotExists() {
    return fs.existsSync(SNAPSHOT_FILE);
}

/**
 * Remove the RAG index directory.
 *
 * Safety net: startFresh() already truncates the session's index file on
 * the server side, but a stale directory from a previous, unrelated
 * experiment on the same API key could still confuse the test. A clean
 * directory guarantees deterministic behaviour.
 */
function cleanRagData() {
    if (fs.existsSync(RAG_DATA_DIR)) {
        fs.rmSync(RAG_DATA_DIR, { recursive: true, force: true });
        console.log(`🧹 Removed ${RAG_DATA_DIR}`);
    } else {
        console.log(`🧹 ${RAG_DATA_DIR} not present, nothing to clean`);
    }
}

/**
 * Build a marker file with a unique marker, topic, four facts, and a
 * body of readable prose. The marker provides a deterministic check;
 * the prose gives any snapshot something meaningful to summarize.
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

// ============================================================
// HTTP HELPERS
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
    return data?.choices?.[0]?.message?.content || '';
}

function readChatState() {
    if (!fs.existsSync(CHAT_STATE_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(CHAT_STATE_FILE, 'utf-8')).deepseek || null;
    } catch {
        return null;
    }
}

async function newChat(restore = false) {
    return await fetchJSON(`${SERVER_URL}/v1/chat/new`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ restore }),
    });
}

async function chat(messages) {
    return await fetchJSON(`${SERVER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ messages, extra_body: {} }),
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

async function contextStatus() {
    return await fetchJSON(`${SERVER_URL}/v1/context/status`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
    });
}

// ============================================================
// SHARED STEPS
// ============================================================

/**
 * Create four marker files with unique names for a given series prefix.
 */
function createSeriesMarkers(prefix) {
    return {
        a: makeMarkerFile(path.join(TMP_DIR, `${prefix}-A.txt`), 'ALPHA', 'History of Rome', [
            'The Aqua Virgo aqueduct was completed in 19 BC.',
            'The Colosseum could hold between 50,000 and 80,000 spectators.',
            'The Western Roman Empire fell in 476 AD.',
            'The Roman Empire reached its greatest extent under Trajan in 117 AD.',
        ], 12500),
        b: makeMarkerFile(path.join(TMP_DIR, `${prefix}-B.txt`), 'BETA', 'Geography of Japan', [
            'Mount Fuji is the highest mountain in Japan at 3,776 meters.',
            'The Japanese archipelago consists of four main islands.',
            'Tokyo is the capital and most populous city of Japan.',
            'The Sea of Japan separates Japan from the Asian mainland.',
        ], 12500),
        c: makeMarkerFile(path.join(TMP_DIR, `${prefix}-C.txt`), 'GAMMA', 'Quantum Mechanics', [
            'The Schrödinger equation describes quantum state evolution over time.',
            'Quantum entanglement links the states of two or more particles.',
            'The uncertainty principle was formulated by Heisenberg in 1927.',
            'Wave-particle duality is demonstrated by the double-slit experiment.',
        ], 12500),
        d: makeMarkerFile(path.join(TMP_DIR, `${prefix}-D.txt`), 'DELTA', 'History of Computing', [
            'Charles Babbage designed the Analytical Engine in the 1830s.',
            'Ada Lovelace wrote the first algorithm intended for a machine.',
            'The Turing machine model was introduced by Alan Turing in 1936.',
            'ENIAC, completed in 1945, was the first programmable electronic computer.',
        ], 12500),
    };
}

/**
 * Upload the four marker files, crossing both thresholds.
 */
async function fillWithMarkers(prefix, markers) {
    const files = ['a', 'b', 'c', 'd'].map(k =>
        path.join(TMP_DIR, `${prefix}-${k.toUpperCase()}.txt`)
    );
    const labels = ['A', 'B', 'C', 'D'];

    console.log(`   Markers: A=${markers.a.marker}, B=${markers.b.marker}, ` +
                `C=${markers.c.marker}, D=${markers.d.marker}`);

    for (let i = 0; i < files.length; i++) {
        const label = labels[i];
        const pct = 25 * (i + 1);
        console.log(`\n   [upload ${label}] ~${pct}%`);
        const up = await uploadFilesMultipart([files[i]], 'Reply with the UNIQUE_MARKER only.');
        const ctx = await contextStatus();
        logResult(`   Upload ${label} ok`, up.ok, `percent=${ctx.data?.percent}%`);
    }
}

/**
 * Ask the model to recall a marker.
 *
 * A single phrasing is used for both series: the surrounding system
 * instruction (snapshot upload prompt or RAG upload prompt) tells the
 * model that any attached file is an authoritative source, so the user
 * question itself must not refer to the file or to earlier uploads.
 *
 * @param {string} marker - Marker value expected in the answer.
 * @param {string} label  - Test label for logging.
 * @param {string} topic  - Topic hint passed to the model.
 */
async function askMarker(marker, label, topic) {
    const content =
        `What is the UNIQUE_MARKER value for the topic '${topic}'? ` +
        `Reply with only the marker string.`;

    const res = await chat([{ role: 'user', content }]);
    const text = getResponseContent(res.data);
    logResult(`${label} responded`, res.ok && text.length > 0, `answer: "${text.substring(0, 100)}"`);
    logResult(`${label} recalled`, text.includes(marker), `expected ${marker}`);
}

// ============================================================
// PHASE 0 — simple restore (no RAG, no snapshot)
// ============================================================

async function phase0() {
    logPhase('PHASE 0: simple restore');

    await startServerAndWait({
        ENABLE_RAG: 'false',
        ENABLE_SNAPSHOT: 'false',
        ENABLE_RESTORE: 'false',
    });

    const marker = `TEAL_${Date.now()}`;

    console.log('\n[P0.1] Fresh chat, ask the model to remember a code');
    await newChat(false);
    const sendRes = await chat([{
        role: 'user',
        content: `Please remember this code: ${marker}. Reply with the word OK.`,
    }]);
    const sendText = getResponseContent(sendRes.data);
    logResult('P0.1 responded', sendRes.ok && /ok/i.test(sendText),
        `answer: "${sendText.substring(0, 60)}"`);
    const savedBefore = readChatState();
    logResult('P0.1 lastChatId assigned', !!savedBefore?.lastChatId);

    console.log('\n[P0.2] Restart server, auto-restore');
    await stopServer();
    await startServerAndWait({
        ENABLE_RAG: 'false',
        ENABLE_SNAPSHOT: 'false',
        ENABLE_RESTORE: 'true',
    });

    const restored = readChatState();
    logResult('P0.2 lastChatId preserved',
        restored?.lastChatId === savedBefore?.lastChatId,
        `before=${savedBefore?.lastChatId}, after=${restored?.lastChatId}`);

    console.log('\n[P0.3] Ask for the code — restored context must contain it');
    const recallRes = await chat([{
        role: 'user',
        content: 'What code did I ask you to remember? Reply with the code only.',
    }]);
    const recallText = getResponseContent(recallRes.data);
    logResult('P0.3 responded', recallRes.ok && recallText.length > 0);
    logResult('P0.3 code recalled', recallText.includes(marker), `expected ${marker}`);

    await stopServer();
}

// ============================================================
// PARAMETRIC SERIES
// ============================================================

/**
 * Run one context-transfer series end to end.
 *
 * @param {object} opts
 * @param {string} opts.name - Series name, used in filenames and log labels.
 * @param {object} opts.env - Extra environment variables for the server.
 * @param {boolean} opts.expectSnapshotFile - Expected presence of snapshot.txt
 *                                            after filling the chat.
 * @param {boolean} opts.expectSnapshotDone - Expected value of snapshot70Done
 *                                            and snapshot90Done after filling.
 * @param {boolean} opts.expectRagActive - Expected value of ragSearchActive
 *                                         after the transition.
 * @param {boolean} opts.cleanRag - Whether to wipe rag_data/ before starting.
 */
async function runContextTransferSeries(opts) {
    const { name, env, expectSnapshotFile, expectSnapshotDone, expectRagActive, cleanRag } = opts;

    logPhase(`SERIES ${name}`);

    if (cleanRag) {
        cleanRagData();
    }

    const prefix = name.toLowerCase();
    const markers = createSeriesMarkers(prefix);

    // ---- 1. Spawn and prepare ----
    await startServerAndWait({
        ...env,
        ENABLE_RESTORE: 'true',
        DEEPSEEK_MAX_CONTEXT_CHARS: CONTEXT_LIMIT,
    });

    console.log(`\n[${name}.1] Fresh chat, pre-threshold state`);
    await newChat(false);
    const s0 = readChatState();
    logResult(`${name}.1 snapshot70Done=false`, s0?.snapshot70Done === false);
    logResult(`${name}.1 snapshot90Done=false`, s0?.snapshot90Done === false);
    logResult(`${name}.1 ragSearchActive=false`, s0?.ragSearchActive === false);
    logResult(`${name}.1 snapshot.txt absent`, !snapshotExists());

    // ---- 2. Fill with marker files ----
    console.log(`\n[${name}.2] Upload A, B, C, D`);
    await fillWithMarkers(prefix, markers);

    const afterFill = readChatState();
    logResult(`${name}.2 snapshot70Done=${expectSnapshotDone}`,
        afterFill?.snapshot70Done === expectSnapshotDone,
        `snapshot70Done=${afterFill?.snapshot70Done}`);
    logResult(`${name}.2 snapshot90Done=${expectSnapshotDone}`,
        afterFill?.snapshot90Done === expectSnapshotDone,
        `snapshot90Done=${afterFill?.snapshot90Done}`);
    logResult(`${name}.2 snapshot.txt exists=${expectSnapshotFile}`,
        snapshotExists() === expectSnapshotFile,
        `actual=${snapshotExists()}`);

    // ---- 3. Trigger transition ----
    console.log(`\n[${name}.3] Trigger transition`);
    const before = readChatState();
    const triggerRes = await chat([{
        role: 'user',
        content: 'Confirm readiness by replying with OK.',
    }]);
    logResult(`${name}.3 responded`, triggerRes.ok,
        `answer: "${getResponseContent(triggerRes.data).substring(0, 40)}"`);
    await sleep(2000);

    const afterTransition = readChatState();
    logResult(`${name}.3 lastChatId changed`,
        afterTransition?.lastChatId !== before?.lastChatId,
        `before=${before?.lastChatId}, after=${afterTransition?.lastChatId}`);
    logResult(`${name}.3 ragSearchActive=${expectRagActive}`,
        afterTransition?.ragSearchActive === expectRagActive,
        `ragSearchActive=${afterTransition?.ragSearchActive}`);
    logResult(`${name}.3 totalChars reset`,
        (afterTransition?.totalChars || 0) < (before?.totalChars || 0),
        `before=${before?.totalChars}, after=${afterTransition?.totalChars}`);
    logResult(`${name}.3 snapshot70Done=false`, afterTransition?.snapshot70Done === false);
    logResult(`${name}.3 snapshot90Done=false`, afterTransition?.snapshot90Done === false);
    logResult(`${name}.3 snapshot.txt removed`, !snapshotExists(),
        `exists=${snapshotExists()}`);

    // ---- 4. Verify context transfer (marker A) ----
    console.log(`\n[${name}.4] Ask about marker A — context transfer check`);
    await askMarker(markers.a.marker, `${name}.4 marker-A`, 'History of Rome');

    // ---- 5. Restart, verify persistence ----
    console.log(`\n[${name}.5] Restart, verify state preserved`);
    await stopServer();
    await startServerAndWait({
        ...env,
        ENABLE_RESTORE: 'true',
        DEEPSEEK_MAX_CONTEXT_CHARS: CONTEXT_LIMIT,
    });

    const restored = readChatState();
    logResult(`${name}.5 lastChatId preserved`,
        restored?.lastChatId === afterTransition?.lastChatId,
        `before=${afterTransition?.lastChatId}, after=${restored?.lastChatId}`);
    logResult(`${name}.5 ragSearchActive preserved=${expectRagActive}`,
        restored?.ragSearchActive === expectRagActive);
    // After a successful transition (step 3), both flags were reset to
    // false. The restart must preserve that, regardless of series.
    logResult(`${name}.5 snapshot70Done=false preserved`,
        restored?.snapshot70Done === false);
    logResult(`${name}.5 snapshot90Done=false preserved`,
        restored?.snapshot90Done === false);

    // ---- 6. Verify context transfer survives restart (marker B) ----
    console.log(`\n[${name}.6] Ask about marker B after restart`);
    await askMarker(markers.b.marker, `${name}.6 marker-B`, 'Geography of Japan');

    await stopServer();
}

// ============================================================
// PHASE 6 — near-limit file (GENERAL config, no RAG, no snapshot)
// ============================================================

async function phase6() {
    logPhase('PHASE 6: near-limit file (GENERAL config)');

    await startServerAndWait({
        ENABLE_RAG: 'false',
        ENABLE_SNAPSHOT: 'false',
        ENABLE_RESTORE: 'true',
        DEEPSEEK_MAX_CONTEXT_CHARS: CONTEXT_LIMIT,
    });

    await newChat(false);

    const fileBig = path.join(TMP_DIR, 'big.txt');
    const big = makeMarkerFile(fileBig, 'BIG', 'Astronomy', [
        'The Andromeda Galaxy is approximately 2.5 million light-years from Earth.',
        'A light-year is about 9.46 trillion kilometers.',
        'The observable universe is roughly 93 billion light-years in diameter.',
        'The cosmic microwave background was first detected in 1964.',
    ], 42000); // ~84% of 50000
    console.log(`   File size: ${big.size} chars (~${Math.round(big.size / 50000 * 100)}%)`);

    console.log('\n[P6.1] Upload near-limit file — no pre-flight rejection');
    const t0 = Date.now();
    const res = await uploadFilesMultipart([fileBig], 'Reply with the UNIQUE_MARKER only.');
    const elapsed = Date.now() - t0;

    const isAccepted = res.ok;
    const isRejected = res.status === 409 && res.data?.error?.type === 'context_exhausted';
    logResult('P6.1 accepted or cleanly rejected',
        isAccepted || isRejected,
        `status=${res.status}, elapsed=${(elapsed / 1000).toFixed(1)}s`);

    if (isAccepted) {
        const text = getResponseContent(res.data);
        logResult('P6.1 marker echoed', text.includes(big.marker), `expected ${big.marker}`);
    } else {
        console.log(`   Banner: ${res.data?.error?.banner_text || '(none)'}`);
    }

    await stopServer();
}

// ============================================================
// MAIN
// ============================================================

async function runTests() {
    console.log('🚀 Context-transfer integration tests (snapshot + RAG)');
    console.log(`🔗 ${SERVER_URL}`);
    console.log(`⚙️  CONTEXT_LIMIT=${CONTEXT_LIMIT}\n`);

    ensureTmp();

    try {
        await phase0();

        await runContextTransferSeries({
            name: 'SNAPSHOT',
            env: {
                ENABLE_SNAPSHOT: 'true',
                ENABLE_RAG: 'false',
            },
            expectSnapshotFile: true,
            expectSnapshotDone: true,
            expectRagActive: false,
            cleanRag: false,
        });

        await runContextTransferSeries({
            name: 'RAG',
            env: {
                ENABLE_SNAPSHOT: 'false',
                ENABLE_RAG: 'true',
            },
            expectSnapshotFile: false,
            expectSnapshotDone: false,
            expectRagActive: true,
            cleanRag: true,
        });

        await phase6();
    } finally {
        await stopServer();
        cleanupTmp();
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`📊 Summary: ${TOTAL - FAILURES}/${TOTAL} passed, ${FAILURES} failed`);
    console.log('═══════════════════════════════════════');

    if (FAILURES > 0) process.exit(1);
}

process.on('SIGINT', async () => {
    console.log('\n⚠️ Interrupted — stopping server');
    await stopServer();
    cleanupTmp();
    process.exit(1);
});

runTests().catch(async (err) => {
    console.error('❌ Test error:', err);
    await stopServer();
    cleanupTmp();
    process.exit(1);
});