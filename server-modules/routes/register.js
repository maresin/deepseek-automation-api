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

    if (isReady() && bothFilesExist()) {
        return res.json({ api_key: getApiKey(), message: 'Session already exists' });
    }

    if (!bothFilesExist()) deleteSessionFiles();

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