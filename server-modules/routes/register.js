// server-modules/routes/register.js
/**
 * @file server-modules/routes/register.js
 * Registration route: creates a new session, initializes DeepSeekClient,
 * stores the generated API key, and (when RAG is enabled) clears the
 * session's RAG index so it starts empty.
 *
 * Response shape:
 *   { api_key: string, message: string }
 */

const fs = require('fs');
const {
    getApiKey,
    saveApiKey,
    generateApiKey,
    deleteSessionFiles,
    bothFilesExist,
} = require('../utils');
const { setClientAndScheduler, isReady } = require('../state');
const { DeepSeekClient } = require('../../dist');
const { getClientConfig } = require('../clientConfig');

module.exports = async function registerRoute(req, res) {
    const { email, password } = req.body;

    // If we already have an API key, return it — do not regenerate.
    // The old check required both state.json AND .api-key; in CDP
    // mode state.json is intentionally absent, so the old check always
    // failed and wiped the key on every POST.
    const existingKey = getApiKey();
    if (existingKey && isReady()) {
        return res.json({ api_key: existingKey, message: 'Session already exists' });
    }

    // Only clean up if neither file exists (first-ever run).
    const keyExists = fs.existsSync(process.env.DEEPSEEK_API_KEY_PATH || './.api-key');
    const stateExists = fs.existsSync(process.env.DEEPSEEK_STATE_PATH || './state.json');
    if (!keyExists && !stateExists) {
        deleteSessionFiles();
    }

    const apiKey = generateApiKey();
    const config = getClientConfig({ email, password });
    const newClient = new DeepSeekClient(config);

    // Assign the api key before initialize() so that startFresh() can clear
    // the correct RAG index for this session.
    newClient.apiKey = apiKey;

    await newClient.initialize();

    saveApiKey(apiKey);
    setClientAndScheduler(newClient, null);

    if (process.env.ENABLE_RAG === 'true') {
        try {
            const { getHistoryStore } = require('../../dist/rag/init.js');
            const store = await getHistoryStore(apiKey);
            await store.clear();
            console.log(`📚 RAG store created (cleared) for session ${apiKey}`);
        } catch (err) {
            console.error('Failed to create/clear RAG store:', err);
        }
    }

    console.log(`✅ Registration complete! API key: ${apiKey}`);
    res.json({ api_key: apiKey, message: 'Store this API key securely.' });
};