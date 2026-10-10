// server.js
/**
 * @file server.js
 * Main entry point for the DeepSeek Automation API server.
 * Provides OpenAI-compatible endpoints for chat, file upload, and session management.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { globalLimiter, chatLimiter, uploadLimiter, authenticate } = require('./server-modules/middleware');
const registerRoute = require('./server-modules/routes/register');
const chatRoute = require('./server-modules/routes/chat');
const { uploadFile } = require('./server-modules/routes/files');
const { initFromExistingFiles } = require('./server-modules/init');
const { bothFilesExist } = require('./server-modules/utils');
const { getClient, isReady } = require('./server-modules/state');
const singleRoute = require('./server-modules/routes/single.js');
const { Selectors } = require('./dist/browser/Selectors.js');
require('dotenv').config();

// ============================================================
// STATE FILE HELPERS — mtime-guarded atomic write
// ============================================================
//
// The shared-state scenario (two agents, one state.json) makes
// last-writer-wins the wrong policy: a process that read the
// file at T=0 can overwrite a fresher copy written at T=5.
//
// readStateMtime() records the mtime observed at read time.
// writeStateAtomically() refuses to write if the file has been
// modified since — meaning another process already wrote a
// fresher copy. The write itself is atomic: write to .tmp, then
// rename. renameSync is atomic on POSIX and on NTFS, so a
// concurrent reader never observes a partial file.

const readStateMtime = (statePath) => {
    try {
        return fs.statSync(statePath).mtimeMs;
    } catch {
        return 0; // file does not exist yet
    }
};

const writeStateAtomically = (statePath, loadedAtMs, state) => {
    if (loadedAtMs > 0) {
        try {
            const stat = fs.statSync(statePath);
            if (stat.mtimeMs > loadedAtMs) {
                console.log(`💾 Skipping state write (mtime ${stat.mtimeMs} > ${loadedAtMs})`);
                return false;
            }
        } catch {}
    }

    const tmp = statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, statePath);
    console.log(`💾 State saved (${state.cookies?.length || 0} cookies, mtime ${Date.now()})`);
    return true;
};

// ============================================================
// RESOLVED PATHS
// ============================================================
// Centralized path resolution. Every write to the browser state
// file must go through STATE_PATH — otherwise DEEPSEEK_STATE_PATH
// is silently ignored on the startup validation path, and two
// agents configured for a shared state file end up writing to
// ./state.json in their respective cwd.
const STATE_PATH = process.env.DEEPSEEK_STATE_PATH
    ? require('path').resolve(process.env.DEEPSEEK_STATE_PATH)
    : require('path').join(process.cwd(), 'state.json');

console.log(`💾 State file: ${STATE_PATH}`);

const app = express();
const { getUploadsDir } = require('./dist/utils/paths.js');
const upload = multer({ dest: getUploadsDir() });

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(globalLimiter);
app.use('/v1/chat/completions', chatLimiter);
app.use('/v1/files', uploadLimiter);

// Log all requests
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// REGISTRATION
// ============================================================

app.post('/v1/register', registerRoute);

// ============================================================
// FILE UPLOAD ROUTES
// ============================================================

// OpenAI-compatible file upload (returns file_id)
app.post('/v1/files', authenticate, upload.single('file'), uploadFile);

// ============================================================
// CHAT COMPLETIONS (supports both single and multiple files)
// ============================================================

app.post('/v1/chat/completions', authenticate, upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 50 }
]), (req, res, next) => {
    // Combine files from both fields
    const allFiles = [];
    if (req.files?.file) allFiles.push(...req.files.file);
    if (req.files?.files) allFiles.push(...req.files.files);
    req.body.files = allFiles;

    // Parse data field (JSON with messages, extra_body, tools)
    if (req.body.data) {
        try {
            const parsedData = JSON.parse(req.body.data);
            req.body = { ...req.body, ...parsedData };
        } catch (err) {
            return res.status(400).json({ error: 'Invalid JSON in data field' });
        }
    }

    next();
}, chatRoute);

// ============================================================
// SINGLE REQUEST (temporary chat)
// ============================================================

app.post('/v1/chat/single', authenticate, upload.single('file'), singleRoute);

// ============================================================
// NEW CHAT
// ============================================================

app.post('/v1/chat/new', authenticate, async (req, res) => {
    if (!isReady()) {
        return res.status(503).json({ error: 'Client not ready' });
    }
    const { restore } = req.body;
    const client = getClient();
    try {
        await client.newChat({ restore: restore || false });
        res.json({ success: true, restore: restore || false });
    } catch (err) {
        const msg = err.message || '';
        if (msg.startsWith('restore_failed:')) {
            const reason = msg.split(':')[1] || 'unknown';
            console.warn(`⚠️ Restore failed: ${reason}`);
            return res.status(409).json({
                error: {
                    type: 'restore_failed',
                    reason,
                    message: reason === 'chat_not_found'
                        ? 'The last chat session could not be found. Persistent state has been cleared.'
                        : reason === 'no_last_chat_id'
                            ? 'No previous chat session recorded. Nothing to restore.'
                            : 'Restore failed for an unknown reason.',
                    state_cleared: true,
                }
            });
        }
        console.error('Failed to create new chat:', err);
        res.status(500).json({ error: msg });
    }
});

// ============================================================
// CONTEXT STATUS (internal, for debugging)
// ============================================================

app.get('/v1/context/status', authenticate, async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });
    const maxChars = client.contextManager.getDynamicMaxChars();
    res.json({
        totalChars: client.contextManager.totalChars,
        maxChars,
        percent: Math.round(client.contextManager.totalChars / maxChars * 100),
        snapshot70Done: client.contextManager.snapshot70Done,
        snapshot90Done: client.contextManager.snapshot90Done,
    });
});

// ============================================================
// PERFORM AUTO-LOGIN
// ============================================================

/**
 * Performs auto-login on the login page.
 * @param {import('playwright-core').Page} page - Playwright page object.
 * @param {string} email - Email address.
 * @param {string} password - Password.
 * @returns {Promise<boolean>} true if login successful.
 */
async function performAutoLogin(page, email, password) {
    try {
        console.log('🔐 Performing auto-login...');

        await page.waitForSelector(Selectors.emailInput, { timeout: 10000 });

        const emailInput = await page.$(Selectors.emailInput);
        if (emailInput) {
            await emailInput.fill(email);
            console.log('✓ Email filled');
        } else {
            console.warn('⚠️ Email field not found');
            return false;
        }

        const passwordInput = await page.$(Selectors.passwordInput);
        if (passwordInput) {
            await passwordInput.fill(password);
            console.log('✓ Password filled');
        } else {
            console.warn('⚠️ Password field not found');
            return false;
        }

        await page.waitForTimeout(500);

        const loginButton = await page.$(Selectors.loginButton) ||
                            await page.$(Selectors.loginButtonFallback);
        if (loginButton) {
            await loginButton.click();
            console.log('✓ Login button clicked');
        } else {
            console.warn('⚠️ Login button not found');
            return false;
        }

        await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
        console.log('✅ Auto-login successful');

        const context = page.context();
        const state = await context.storageState();
        // The login flow always produces the freshest possible cookies,
        // so we do NOT pass a mtime guard here — this write is
        // unconditional and wins over any concurrent writer.
        writeStateAtomically(STATE_PATH, 0, state);
        console.log('💾 State saved after auto-login');

        return true;
    } catch (err) {
        console.error('❌ Auto-login failed:', err.message);
        return false;
    }
}

// ============================================================
// SELECTOR VALIDATION
// ============================================================

const { validateSelectors } = require('./server-modules/selector-validator');

/**
 * Validates the environment before starting the server.
 * Checks language and critical selectors.
 * Exits if critical selectors are missing.
 */
async function validateEnvironment() {
    console.log('🔧 Validating environment...');

    if (!bothFilesExist()) {
        console.log('⚠️ No session. Auth on first request.');
        return;
    }

    const { chromium } = require('playwright-core');
    const { getChromiumExecutablePath, getUploadsDir } = require('./dist/utils/paths.js');

    let browser;
    let context;
    let stateLoadedAtMs = readStateMtime(STATE_PATH);
    try {
        browser = await chromium.launch({ headless: true, executablePath: getChromiumExecutablePath() });
        context = await browser.newContext({
            storageState: STATE_PATH,
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        const page = await context.newPage();

        await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded' });

        const url = page.url();
        if (url.includes('/sign_in')) {
            console.log('📌 On login page, attempting auto-login...');
            const email = process.env.DEEPSEEK_EMAIL;
            const password = process.env.DEEPSEEK_PASSWORD;
            if (email && password) {
                const loggedIn = await performAutoLogin(page, email, password);
                if (!loggedIn) {
                    console.warn('⚠️ Auto-login failed, continuing with limited validation');
                }
            } else {
                console.warn('⚠️ No credentials in .env, skipping auto-login');
            }
        }

        try {
            await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
        } catch {
            console.warn('⚠️ Chat page did not load, continuing with limited validation');
        }

        const { results, allFound } = await validateSelectors(page);

        if (!allFound) {
            console.error('🚫 Critical selectors missing. API cannot start.');
            process.exit(1);
        }

        console.log('✅ Critical selectors OK');

        if (context) {
            const state = await context.storageState();
            writeStateAtomically(STATE_PATH, stateLoadedAtMs, state);
        }

    } catch (err) {
        console.error('❌ Validation error:', err.message);
        console.warn('⚠️ Starting with limited validation.');
    } finally {
        if (browser) await browser.close();
    }
}

// ============================================================
// SHUTDOWN HANDLING
// ============================================================

process.on('SIGINT', async () => {
    console.log('\n🧹 Shutting down...');
    try {
        const { getIndexingQueue } = require('./dist/rag/IndexingQueue.js');
        await getIndexingQueue().shutdown(30000);
    } catch (err) {
        console.warn('Indexing queue shutdown failed:', err);
    }
    const { getClient } = require('./server-modules/state');
    const client = getClient();
    if (client) {
        await client.cleanup();
        await client.close();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🧹 Shutting down (SIGTERM)...');
    try {
        const { getIndexingQueue } = require('./dist/rag/IndexingQueue.js');
        await getIndexingQueue().shutdown(30000);
    } catch (err) {
        console.warn('Indexing queue shutdown failed:', err);
    }
    const { getClient } = require('./server-modules/state');
    const client = getClient();
    if (client) {
        await client.cleanup();
        await client.close();
    }
    process.exit(0);
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;

if (process.env.ENABLE_RAG === 'true') {
    console.log('✅ RAG module enabled');
}

// Bind the port first. If it is already in use, exit immediately —
// before validateEnvironment() spawns a Chromium instance that would
// be wasted (login, selector check) on a process that is about to die.
const server = app.listen(PORT, () => {
    console.log(`🚀 DeepSeek API server running on http://localhost:${PORT}`);
    console.log(`   POST /v1/register - Create session`);
    console.log(`   POST /v1/chat/completions - Chat`);
    console.log(`   POST /v1/chat/new - Create new chat`);
    console.log(`   POST /v1/chat/single - Single request (with optional context insertion)`);
    console.log(`   POST /v1/files - Upload file (OpenAI-compatible, returns file_id)`);
    console.log(`   GET /health - Status`);
    if (bothFilesExist()) {
        console.log(`\n📂 Session files detected. Will restore automatically...`);
    } else {
        console.log(`\n💡 No session. Register: POST /v1/register`);
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`✗ Port ${PORT} is already in use.`);
        console.error(`  Kill the existing process: pkill -f "node server.js"`);
        process.exit(1);
    }
    throw err;
});

// ============================================================
// AUTO-REGISTRATION (if credentials in .env)
// ============================================================

async function autoRegisterIfNeeded() {
    const email = process.env.DEEPSEEK_EMAIL;
    const password = process.env.DEEPSEEK_PASSWORD;
    if (!email || !password) {
        console.log('🔐 No credentials in env. Manual registration required.');
        return;
    }
    if (bothFilesExist()) {
        console.log('📂 Session files exist, will restore via initFromExistingFiles');
        return;
    }
    console.log('🚀 Auto-registering with credentials from env...');
    const req = { body: { email, password } };
    const res = {
        json: (data) => console.log(`✅ Auto-registration successful. API key: ${data.api_key}`),
        status: () => ({ json: (err) => console.error('Auto-registration failed:', err) })
    };
    await registerRoute(req, res);
}

// ============================================================
// STARTUP SEQUENCE
// ============================================================
//
// The three startup steps are ordered explicitly. Each step may
// write DEEPSEEK_STATE_PATH, so running them in parallel — as the
// previous version did with .catch() and setTimeout() — creates
// a race: initFromExistingFiles could read the state file before
// validateEnvironment had a chance to refresh it, leaving the
// in-memory client with stale cookies while a fresher copy
// landed on disk moments later.
//
//   1. validateEnvironment  — selector check; performs auto-login
//                             when cookies are missing or expired.
//                             Its writes are mtime-guarded.
//   2. autoRegisterIfNeeded — only when neither .api-key nor
//                             state.json exist. Never runs if
//                             step 1 produced a session.
//   3. initFromExistingFiles — reads the final on-disk state and
//                             brings up the client with ENABLE_RESTORE
//                             semantics.
//
// A failure in any step is logged but does not abort the sequence:
// the HTTP server is already listening and a later /v1/register
// call can still recover the process.

(async () => {
    try {
        await validateEnvironment();
    } catch (err) {
        console.error('❌ validateEnvironment failed:', err);
    }

    try {
        await autoRegisterIfNeeded();
    } catch (err) {
        console.error('❌ autoRegisterIfNeeded failed:', err);
    }

    try {
        await initFromExistingFiles();
    } catch (err) {
        console.error('❌ initFromExistingFiles failed:', err);
    }
})();