// server-modules/routes/files.js
const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { SendUserMessageTask } = require('../../dist');
const { getHistoryStore } = require('../../dist/rag/init.js');

// Простая функция разбиения текста на чанки (если нет отдельного модуля)
function chunkText(text, maxChars = 2000) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxChars) {
        chunks.push(text.slice(i, i + maxChars));
    }
    return chunks;
}

// Вспомогательная функция для индексации файла (синхронная, но внутри вызывает асинхронные методы)
async function indexFile(store, filePath, originalName) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const chunks = chunkText(content);
        for (let i = 0; i < chunks.length; i++) {
            await store.addFileChunk(originalName, i, chunks[i]);
        }
        console.log(`📎 Indexed ${chunks.length} chunks from file ${originalName}`);
    } catch (err) {
        console.error(`Failed to index file ${originalName}:`, err.message);
    }
}

async function uploadSingle(req, res) {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const client = getClient();
    if (!client) {
        return res.status(503).json({ error: 'Client not ready' });
    }

    const message = req.body.message || "";
    const ext = path.extname(file.originalname);
    const fileWithExt = file.path + ext;
    fs.renameSync(file.path, fileWithExt);

    // RAG индексация, если включена
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (process.env.ENABLE_RAG === 'true' && apiKey) {
        try {
            const store = await getHistoryStore(apiKey);
            await indexFile(store, fileWithExt, file.originalname);
        } catch (err) {
            console.error('RAG indexing failed:', err);
        }
    }

    // Отправляем файл в DeepSeek (через TaskQueue)
    const task = new SendUserMessageTask(message, fileWithExt);
    task.run(client)
        .then(responseContent => {
            // Удаляем временный файл
            if (fs.existsSync(fileWithExt)) {
                fs.unlinkSync(fileWithExt);
            }
            const openaiResponse = {
                id: `uploadcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'deepseek-chat',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: responseContent },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: Math.ceil(responseContent.length / 4),
                    total_tokens: Math.ceil(responseContent.length / 4)
                }
            };
            res.json(openaiResponse);
        })
        .catch(err => {
            if (fs.existsSync(fileWithExt)) {
                fs.unlinkSync(fileWithExt);
            }
            console.error('Upload error:', err);
            res.status(500).json({ error: err.message });
        });
}

async function uploadMultiple(req, res) {
    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const client = getClient();
    if (!client) {
        return res.status(503).json({ error: 'Client not ready' });
    }

    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    const store = (process.env.ENABLE_RAG === 'true' && apiKey) ? await getHistoryStore(apiKey).catch(() => null) : null;

    // Обрабатываем все файлы: индексируем и сохраняем временные пути
    const tempFiles = [];
    for (const file of files) {
        const ext = path.extname(file.originalname);
        const tempPath = file.path + ext;
        fs.renameSync(file.path, tempPath);
        tempFiles.push({ path: tempPath, name: file.originalname });

        if (store) {
            await indexFile(store, tempPath, file.originalname);
        }
    }

    // Для простоты обрабатываем только первый файл в диалоге
    const firstFile = tempFiles[0];
    const message = req.body.message || "";

    const task = new SendUserMessageTask(message, firstFile.path);
    task.run(client)
        .then(responseContent => {
            // Удаляем все временные файлы
            for (const tf of tempFiles) {
                if (fs.existsSync(tf.path)) fs.unlinkSync(tf.path);
            }
            res.json({
                success: true,
                response: responseContent,
                message: `Processed first of ${files.length} files`
            });
        })
        .catch(err => {
            for (const tf of tempFiles) {
                if (fs.existsSync(tf.path)) fs.unlinkSync(tf.path);
            }
            console.error('Upload error:', err);
            res.status(500).json({ error: err.message });
        });
}

module.exports = { uploadSingle, uploadMultiple };