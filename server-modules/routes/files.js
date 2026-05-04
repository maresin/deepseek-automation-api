const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { SendUserMessageTask } = require('../../dist');
const { RagManager } = require('../rag-manager.js');
const { chunkText } = require('../chunking.js');

// Глобальное хранилище RAG-менеджеров (ключ — API key)
const ragSessions = (global).__ragSessions || new Map();
global.__ragSessions = ragSessions;

function getRagManager(apiKey) {
    if (process.env.ENABLE_RAG !== 'true') return null;
    if (!ragSessions.has(apiKey)) {
        ragSessions.set(apiKey, new RagManager(apiKey));
    }
    return ragSessions.get(apiKey);
}

async function uploadSingle(req, res) {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });
    
    const message = req.body.message || "";
    const ext = path.extname(file.originalname);
    const fileWithExt = file.path + ext;
    fs.renameSync(file.path, fileWithExt);
    
    // RAG: индексация чанков файла (если включено)
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    const rag = getRagManager(apiKey);
    if (rag) {
        try {
            const fileContent = fs.readFileSync(fileWithExt, 'utf-8');
            const chunks = chunkText(fileContent);
            for (let i = 0; i < chunks.length; i++) {
                await rag.addFileChunk(file.originalname, i, chunks[i]);
            }
            console.log(`📎 Indexed ${chunks.length} chunks from file ${file.originalname}`);
        } catch (err) {
            console.error('Failed to index file chunks:', err);
        }
    }
    
    // Отправка в DeepSeek (как обычно)
    const task = new SendUserMessageTask(message, fileWithExt);
    client.taskQueue.add(task)
        .then(responseContent => {
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
        })
        .catch(err => {
            if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);
            console.error('Upload error:', err);
            res.status(500).json({ error: err.message });
        });
}

function uploadMultiple(req, res) {
    const files = req.files;
    if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });
    
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });
    
    // Для простоты обрабатываем только первый файл
    const file = files[0];
    const ext = path.extname(file.originalname);
    const fileWithExt = file.path + ext;
    fs.renameSync(file.path, fileWithExt);
    
    // RAG индексация (аналогично)
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    const rag = getRagManager(apiKey);
    if (rag) {
        try {
            const fileContent = fs.readFileSync(fileWithExt, 'utf-8');
            const chunks = chunkText(fileContent);
            for (let i = 0; i < chunks.length; i++) {
                rag.addFileChunk(file.originalname, i, chunks[i]);
            }
        } catch (err) {}
    }
    
    const task = new SendUserMessageTask("", fileWithExt);
    client.taskQueue.add(task)
        .then(responseContent => {
            if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);
            res.json({
                success: true,
                response: responseContent,
                message: `Processed first of ${files.length} files`
            });
        })
        .catch(err => {
            if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);
            console.error('Upload error:', err);
            res.status(500).json({ error: err.message });
        });
}

module.exports = { uploadSingle, uploadMultiple };