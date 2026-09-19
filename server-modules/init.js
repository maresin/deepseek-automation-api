// server-modules/init.js
/**
 * @file server-modules/init.js
 * Restores a session from existing files at server startup.
 *
 * If .api-key and state.json are present, a DeepSeekClient is created,
 * initialized (which reopens the last chat when ENABLE_RESTORE=true),
 * and registered in the shared state module.
 *
 * The api key is assigned to the client before initialize() so that
 * startFresh() (called during initialize when restore is not possible
 * or not requested) can clear the correct RAG index.
 */

const { bothFilesExist, getApiKey, getSystemPrompt } = require('./utils');
const { setClientAndScheduler } = require('./state');
const { DeepSeekClient } = require('../dist');
const { getClientConfig } = require('./clientConfig');

async function initFromExistingFiles() {
    if (!bothFilesExist()) return;

    console.log('📂 Found existing session files. Attempting to restore...');

    const apiKey = getApiKey();
    const systemPrompt = getSystemPrompt();
    const config = getClientConfig({ systemPrompt });
    const newClient = new DeepSeekClient(config);

    // Assign the api key before initialize() so that startFresh() can clear
    // the correct RAG index for this session.
    newClient.apiKey = apiKey;

    try {
        await newClient.initialize();
        setClientAndScheduler(newClient, null);
        console.log(`✅ Session restored. API key: ${apiKey}`);
    } catch (err) {
        console.error('Failed to restore session:', err);
    }
}

module.exports = { initFromExistingFiles };