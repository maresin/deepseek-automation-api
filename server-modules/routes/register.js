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

    // Инициализация автоматически создаст чат и отправит системный промпт (через очередь)
    await newClient.initialize();

    saveApiKey(apiKey);
    // Устанавливаем глобальный клиент (TaskScheduler больше не нужен, но оставим для совместимости)
    setClientAndScheduler(newClient, null); // scheduler = null, так как мы больше не используем старый scheduler
    console.log(`✅ Registration complete! API key: ${apiKey}`);
    res.json({ api_key: apiKey, message: 'Store this API key securely.' });
};