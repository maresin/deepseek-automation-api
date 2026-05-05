// server-modules/init.js
const { bothFilesExist, getApiKey, getSystemPrompt } = require('./utils');
const { setClientAndScheduler } = require('./state');
const { DeepSeekClient } = require('../dist');
const { getClientConfig } = require('./clientConfig');

async function initFromExistingFiles() {
    if (bothFilesExist()) {
        console.log('📂 Found existing session files. Attempting to restore...');
        const apiKey = getApiKey();
        const systemPrompt = getSystemPrompt();
        const config = getClientConfig({ systemPrompt });
        const newClient = new DeepSeekClient(config);
        try {
            await newClient.initialize();
            setClientAndScheduler(newClient, null);
            console.log(`✅ Session restored. API key: ${apiKey}`);
        } catch (err) {
            console.error('Failed to restore session:', err);
        }
    }
}

module.exports = { initFromExistingFiles };