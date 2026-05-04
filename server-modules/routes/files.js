const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { SendUserMessageTask } = require('../../dist');
const { getHistoryStore } = require('../../dist/rag/init.js');

async function uploadSingle(req, res) {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    const message = req.body.message || "";
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    // Устанавливаем глобальный apiKey для доступа из задачи
    global.currentApiKey = apiKey;

    const ext = path.extname(file.originalname);
    const fileWithExt = file.path + ext;
    fs.renameSync(file.path, fileWithExt);

    const task = new SendUserMessageTask(message, fileWithExt);
    let responseContent;
    try {
        responseContent = await client.taskQueue.add(task);
    } catch (err) {
        if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);
        console.error('Upload error:', err);
        return res.status(500).json({ error: err.message });
    }

    // Сохраняем обмен в RAG
    if (process.env.ENABLE_RAG === 'true' && apiKey) {
        try {
            const store = await getHistoryStore(apiKey);
            await store.addExchange(client.currentChatId, message || "[File upload]", responseContent);
            console.log('💾 Exchange saved to RAG store (file upload)');
        } catch (err) {
            console.error('Failed to save exchange to RAG:', err);
        }
    }

    if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);

    const openaiResponse = {
        id: `uploadcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'deepseek-chat',
        choices: [{ index: 0, message: { role: 'assistant', content: responseContent }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
    res.json(openaiResponse);
}

async function uploadMultiple(req, res) {
    const files = req.files;
    if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });

    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    global.currentApiKey = apiKey;

    const file = files[0];
    const ext = path.extname(file.originalname);
    const fileWithExt = file.path + ext;
    fs.renameSync(file.path, fileWithExt);

    const task = new SendUserMessageTask("", fileWithExt);
    let responseContent;
    try {
        responseContent = await client.taskQueue.add(task);
    } catch (err) {
        if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);
        console.error('Upload error:', err);
        return res.status(500).json({ error: err.message });
    }

    if (process.env.ENABLE_RAG === 'true' && apiKey) {
        try {
            const store = await getHistoryStore(apiKey);
            await store.addExchange(client.currentChatId, "[Multiple files upload]", responseContent);
            console.log('💾 Exchange saved to RAG store (multiple files)');
        } catch (err) {
            console.error('Failed to save exchange to RAG:', err);
        }
    }

    if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);

    res.json({
        success: true,
        response: responseContent,
        message: `Processed first of ${files.length} files`
    });
}

module.exports = { uploadSingle, uploadMultiple };