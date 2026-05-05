// server-modules/routes/register.js
const { getApiKey, saveApiKey, generateApiKey, deleteSessionFiles, bothFilesExist, getSystemPrompt } = require('../utils');
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
    const systemPrompt = getSystemPrompt();
    const config = getClientConfig({ email, password, systemPrompt });
    const newClient = new DeepSeekClient(config);

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