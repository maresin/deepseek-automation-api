// server-modules/routes/files.js
const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { SendUserMessageTask } = require('../../dist');

function uploadSingle(req, res) {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });
    
    const message = req.body.message || "";
    const ext = path.extname(file.originalname);
    const fileWithExt = file.path + ext;
    fs.renameSync(file.path, fileWithExt);
    
    // Используем очередь задач
    const task = new SendUserMessageTask(message, fileWithExt);
    client.taskQueue.add(task)
        .then(responseContent => {
            if (fs.existsSync(fileWithExt)) fs.unlinkSync(fileWithExt);
            // Возвращаем OpenAI-совместимый ответ
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
    
    // Для простоты обработаем только первый файл, остальные игнорируем (или можно последовательно)
    const file = files[0];
    const ext = path.extname(file.originalname);
    const fileWithExt = file.path + ext;
    fs.renameSync(file.path, fileWithExt);
    
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