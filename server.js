// server.js - DeepSeek Automation API Server

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { DeepSeekClient } = require('./dist');

const app = express();

const API_KEY_FILE = path.join(__dirname, '.api-key');
const STATE_FILE = path.join(__dirname, 'state.json');
const RESTORE_SESSION = process.env.RESTORE_SESSION === 'true';

let client = null;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: { error: 'Too many requests' } });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Chat rate limit exceeded' } });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Upload rate limit exceeded' } });

app.use(globalLimiter);
app.use('/v1/chat/completions', chatLimiter);
app.use('/v1/files/upload', uploadLimiter);
app.use('/v1/files/upload-multiple', uploadLimiter);

const upload = multer({ dest: 'uploads/' });

function generateApiKey() {
    return 'deepseek_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}

function getApiKey() {
    if (fs.existsSync(API_KEY_FILE)) {
        return fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
    }
    return null;
}

function saveApiKey(apiKey) {
    fs.writeFileSync(API_KEY_FILE, apiKey);
    console.log(`💾 API key saved`);
}

function deleteSessionFiles() {
    if (fs.existsSync(API_KEY_FILE)) fs.unlinkSync(API_KEY_FILE);
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    console.log(`🗑️ Deleted session files`);
}

function bothFilesExist() {
    return fs.existsSync(API_KEY_FILE) && fs.existsSync(STATE_FILE);
}

function ensureFileConsistency() {
    const hasKey = fs.existsSync(API_KEY_FILE);
    const hasState = fs.existsSync(STATE_FILE);
    
    if (hasKey !== hasState) {
        console.log(`⚠️ Inconsistent state (key: ${hasKey}, state: ${hasState}), cleaning up...`);
        deleteSessionFiles();
        return false;
    }
    return hasKey && hasState;
}

async function authenticate(req, res, next) {
    const providedApiKey = req.headers.authorization?.replace('Bearer ', '');
    
    const isValid = ensureFileConsistency();
    
    if (isValid) {
        const savedKey = getApiKey();
        if (providedApiKey && savedKey === providedApiKey) {
            if (!client) {
                console.log('🔄 Restoring session from existing files...');
                client = new DeepSeekClient({ 
                    showBrowser: true, 
                    strategy: 'auto', 
                    statePath: STATE_FILE,
                    restoreSession: RESTORE_SESSION
                });
                await client.initialize();
                console.log('✅ Session restored');
            }
            return next();
        } else {
            return res.status(401).json({ error: 'Invalid API key' });
        }
    }
    
    if (!providedApiKey) {
        return res.status(401).json({ error: 'No session. Please provide email/password for auto-login or use /v1/register' });
    }
    
    console.log(`🆕 First request - creating new session...`);
    
    let email, password;
    if (req.body && req.body.email && req.body.password) {
        email = req.body.email;
        password = req.body.password;
    }
    
    console.log(`   Mode: ${email && password ? 'auto-login' : 'manual login'}`);
    
    const apiKey = generateApiKey();
    
    const newClient = new DeepSeekClient({ 
        showBrowser: true, 
        strategy: 'auto', 
        statePath: STATE_FILE,
        email: email,
        password: password,
        restoreSession: RESTORE_SESSION
    });
    
    await newClient.initialize();
    
    if (email && password) {
        await newClient.sendMessage(SYSTEM_PROMPT);
    }
    
    saveApiKey(apiKey);
    client = newClient;
    
    console.log(`✅ Session created! API key: ${apiKey}`);
    
    req.apiKey = apiKey;
    next();
}

app.get('/health', (req, res) => {
    const hasKey = fs.existsSync(API_KEY_FILE);
    const hasState = fs.existsSync(STATE_FILE);
    res.json({ 
        status: 'ok', 
        registered: hasKey && hasState,
        consistent: hasKey === hasState,
        restoreSession: RESTORE_SESSION,
        timestamp: new Date().toISOString() 
    });
});

app.post('/v1/register', async (req, res) => {
    const { email, password } = req.body;
    
    ensureFileConsistency();
    
    const hasExisting = bothFilesExist();
    if (hasExisting) {
        const existingKey = getApiKey();
        return res.json({ api_key: existingKey, message: 'Session already exists. Use this API key.' });
    }
    
    console.log(`🆕 Registering new session...`);
    console.log(`   Mode: ${email && password ? 'auto-login' : 'manual login'}`);
    
    const apiKey = generateApiKey();
    
    const newClient = new DeepSeekClient({ 
        showBrowser: true, 
        strategy: 'auto', 
        statePath: STATE_FILE,
        email: email,
        password: password,
        restoreSession: RESTORE_SESSION
    });
    
    await newClient.initialize();
    
    if (email && password) {
        await newClient.sendMessage(SYSTEM_PROMPT);
    }
    
    saveApiKey(apiKey);
    client = newClient;
    
    console.log(`✅ Registration complete! API key: ${apiKey}`);
    
    res.json({ 
        api_key: apiKey, 
        message: 'Store this API key securely. It will not be shown again.' 
    });
});

const SYSTEM_PROMPT = `
You are an assistant that can use tools.
Tools are described in JSON format.
When you need to use a tool, respond with ONLY JSON:
{"tool_calls": [{"name": "tool_name", "arguments": {"param": "value"}}]}
When you don't need tools, respond in normal text.
IMPORTANT: Respond in the same language as the user's question.
Confirm with "OK".
`;

function buildPrompt(userMessage, tools) {
    if (!tools || tools.length === 0) return userMessage;
    return `Tools available (JSON):\n${JSON.stringify(tools, null, 2)}\n\nUser question: ${userMessage}`;
}

app.post('/v1/chat/completions', authenticate, async (req, res) => {
    const startTime = Date.now();
    const { messages, tools, extra_body } = req.body;
    
    if (req.apiKey) {
        res.setHeader('X-API-Key', req.apiKey);
    }
    
    try {
        const userMessage = messages.filter(m => m.role === 'user').pop();
        if (!userMessage) return res.status(400).json({ error: 'No user message found' });
        
        const features = {
            deepThink: extra_body?.deepthink || false,
            webSearch: extra_body?.web_search || false,
            expertMode: extra_body?.expert_mode || false
        };
        
        const prompt = buildPrompt(userMessage.content, tools);
        console.log(`📤 Question: ${userMessage.content.substring(0, 100)}...`);
        if (tools?.length) console.log(`🔧 Tools: ${tools.map(t => t.function.name).join(', ')}`);
        
        const response = await client.sendMessage(prompt, features);
        
        let parsedResponse, isToolCall = false;
        try {
            parsedResponse = JSON.parse(response.content);
            if (parsedResponse.tool_calls?.length) isToolCall = true;
        } catch(e) { parsedResponse = { content: response.content }; }
        
        let openaiResponse;
        if (isToolCall) {
            const toolCalls = parsedResponse.tool_calls.map((tc, i) => ({
                id: `call_${Date.now()}_${i}`,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
            }));
            openaiResponse = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'deepseek-chat',
                choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
                usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(response.content.length / 4), total_tokens: Math.ceil((prompt.length + response.content.length) / 4) }
            };
        } else {
            openaiResponse = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'deepseek-chat',
                choices: [{ index: 0, message: { role: 'assistant', content: parsedResponse.content || response.content }, finish_reason: 'stop' }],
                usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(response.content.length / 4), total_tokens: Math.ceil((prompt.length + response.content.length) / 4) }
            };
        }
        
        console.log(`✅ Response sent in ${Date.now() - startTime}ms`);
        res.json(openaiResponse);
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/v1/files/upload', authenticate, upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        const ext = path.extname(file.originalname);
        const fileWithExt = file.path + ext;
        fs.renameSync(file.path, fileWithExt);
        await client.uploadFile(fileWithExt);
        fs.unlinkSync(fileWithExt);
        res.json({ success: true, file_id: file.filename, original_name: file.originalname, size: file.size });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/v1/files/upload-multiple', authenticate, upload.array('files', 10), async (req, res) => {
    try {
        const files = req.files;
        if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });
        const uploadedFiles = [];
        for (const file of files) {
            const ext = path.extname(file.originalname);
            const fileWithExt = file.path + ext;
            fs.renameSync(file.path, fileWithExt);
            await client.uploadFile(fileWithExt);
            fs.unlinkSync(fileWithExt);
            uploadedFiles.push({ file_id: file.filename, original_name: file.originalname, size: file.size });
        }
        res.json({ success: true, files: uploadedFiles, message: `${files.length} files uploaded` });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

process.on('SIGINT', async () => {
    console.log('\n🧹 Shutting down...');
    if (client) await client.close();
    process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 DeepSeek API server running on http://localhost:${PORT}`);
    console.log(`   POST /v1/register - Create session (auto or manual login)`);
    console.log(`   POST /v1/chat/completions - Chat with tools`);
    console.log(`   POST /v1/files/upload - Upload file`);
    console.log(`   GET /health - Server status`);
    console.log(`   RESTORE_SESSION=${RESTORE_SESSION}`);
    
    const hasKey = fs.existsSync(API_KEY_FILE);
    const hasState = fs.existsSync(STATE_FILE);
    
    if (hasKey && hasState) {
        console.log(`\n✅ Session files found. Ready for requests.`);
    } else if (hasKey !== hasState) {
        console.log(`\n⚠️ Incomplete session detected. Cleaning up...`);
        deleteSessionFiles();
        console.log(`   Please register: POST /v1/register`);
    } else {
        console.log(`\n💡 No session. Register: POST /v1/register`);
    }
});