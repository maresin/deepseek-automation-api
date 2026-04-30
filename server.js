// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { globalLimiter, chatLimiter, uploadLimiter, authenticate } = require('./server-modules/middleware');
const registerRoute = require('./server-modules/routes/register');
const chatRoute = require('./server-modules/routes/chat');
const { uploadSingle, uploadMultiple } = require('./server-modules/routes/files');
const { initFromExistingFiles } = require('./server-modules/init');
const { bothFilesExist } = require('./server-modules/utils');
const { getClient, isReady } = require('./server-modules/state');
const { getStatus } = require('./server-modules/routes/settings');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(globalLimiter);
app.use('/v1/chat/completions', chatLimiter);
app.use('/v1/files/upload', uploadLimiter);
app.use('/v1/files/upload-multiple', uploadLimiter);

app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/v1/register', registerRoute);

app.post('/v1/chat/completions', authenticate, upload.single('file'), (req, res, next) => {
    if (req.body.data) {
        try {
            const parsedData = JSON.parse(req.body.data);
            req.body = { ...req.body, ...parsedData };
        } catch (err) {
            return res.status(400).json({ error: 'Invalid JSON in data field' });
        }
    }
    if (req.file) {
        req.body.file = req.file;
    }
    next();
}, chatRoute);

app.post('/v1/files/upload', authenticate, upload.single('file'), uploadSingle);
app.post('/v1/files/upload-multiple', authenticate, upload.array('files', 10), uploadMultiple);
app.post('/v1/chat/new', authenticate, async (req, res) => {
    if (!isReady()) {
        return res.status(503).json({ error: 'Client not ready' });
    }
    const { expert_mode, restore } = req.body;
    const client = getClient();
    try {
        await client.newChat({ expertMode: expert_mode, restore: restore || false });
        res.json({ success: true, expert_mode, restore });
    } catch (err) {
        console.error('Failed to create new chat:', err);
        res.status(500).json({ error: err.message });
    }
});
app.get('/v1/settings/expert/status', authenticate, getStatus);

process.on('SIGINT', async () => {
    console.log('\n🧹 Shutting down...');
    const { getClient } = require('./server-modules/state');
    const client = getClient();
    if (client) await client.close();
    process.exit(0);
});

app.get('/v1/context/status', authenticate, async (req, res) => {
    const client = getClient();
    const stats = {
        totalChars: client.contextManager.totalChars,
        maxChars: client.contextManager.maxChars,
        percent: Math.round(client.contextManager.totalChars / client.contextManager.maxChars * 100),
        snapshotChars: client.contextManager.lastSnapshotChars,
    };
    res.json(stats);
});

process.on('SIGTERM', async () => {
    console.log('\n🧹 Shutting down (SIGTERM)...');
    const { getClient } = require('./server-modules/state');
    const client = getClient();
    if (client) await client.close();
    process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 DeepSeek API server running on http://localhost:${PORT}`);
    console.log(`   POST /v1/register - Create session`);
    console.log(`   POST /v1/chat/completions - Chat`);
    console.log(`   POST /v1/chat/new - Create new chat (with expert mode)`);
    console.log(`   POST /v1/files/upload - Upload file`);
    console.log(`   POST /v1/files/upload-multiple - Upload multiple files`);
    console.log(`   GET /v1/settings/expert/status - Get current mode`);
    console.log(`   GET /health - Status`);
    if (bothFilesExist()) {
        console.log(`\n📂 Session files detected. Will restore automatically...`);
    } else {
        console.log(`\n💡 No session. Register: POST /v1/register`);
    }
});

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

setTimeout(() => autoRegisterIfNeeded().catch(console.error), 1000);
initFromExistingFiles().catch(console.error);