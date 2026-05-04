const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { getHistoryStore } = require('../../dist/rag/init.js');
const { buildPrompt } = require('../utils'); // для поддержки tools, если они переданы

async function sendToDeepSeek(client, text, filePath) {
    const { SendUserMessageTask } = require('../../dist/tasks/SendUserMessageTask.js');
    const task = new SendUserMessageTask(text || '', filePath);
    return await client.taskQueue.add(task);
}

module.exports = async function chatRoute(req, res) {
    const startTime = Date.now();
    const { messages, tools, file } = req.body;
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    const apiKey = req.headers.authorization?.replace('Bearer ', '') || 'default';
    global.currentApiKey = apiKey;

    // RAG активируется только после перехода в новый чат (inRefreshedChat = true)
    const useRAG = process.env.ENABLE_RAG === 'true' && client.inRefreshedChat === true;
    let store = null;
    if (useRAG) {
        try {
            store = await getHistoryStore(apiKey);
        } catch (err) {
            console.warn('Cannot get RAG store:', err);
        }
    }

    const userMessageObj = messages.find(m => m.role === 'user');
    if (!userMessageObj && !file) return res.status(400).json({ error: 'No user message or file provided' });
    const userMessageText = userMessageObj?.content || '';

    // --- RAG: автоматическое обогащение запроса (без изменения tools) ---
    let enrichedText = userMessageText;
    if (useRAG && store && userMessageText) {
        try {
            const results = await store.search(userMessageText, 3);
            if (results.length > 0) {
                const contextBlocks = [];
                for (const r of results) {
                    if (r.item.type === 'exchange') {
                        contextBlocks.push(`User: ${r.item.user}\nAssistant: ${r.item.assistant}`);
                    } else if (r.item.type === 'file') {
                        contextBlocks.push(`[From file ${r.item.fileName}]: ${r.item.content.substring(0, 500)}`);
                    }
                }
                if (contextBlocks.length) {
                    const contextSection = `Relevant previous conversation:\n${contextBlocks.join('\n---\n')}\n\n---\n\n`;
                    enrichedText = contextSection + userMessageText;
                    console.log(`📚 Enriched prompt with ${contextBlocks.length} fragments (RAG active after context transition)`);
                }
            }
        } catch (err) {
            console.error('RAG search failed:', err);
        }
    }

    // --- Обработка файла ---
    let tempFilePath = null;
    if (file) {
        const ext = path.extname(file.originalname);
        tempFilePath = path.join(process.cwd(), 'uploads', `${Date.now()}${ext}`);
        fs.renameSync(file.path, tempFilePath);
    }

    // Формируем окончательный промпт с учётом tools (если они переданы)
    // buildPrompt из utils.js добавляет описание tools в начало сообщения, если они есть.
    // Это оригинальная логика, мы её сохраняем.
    const finalPrompt = buildPrompt(enrichedText, tools);

    // --- Отправка в DeepSeek ---
    const assistantResponse = await sendToDeepSeek(client, finalPrompt, tempFilePath);

    // --- Очистка временного файла ---
    if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
    }

    // --- Сохранение обмена в RAG (только если RAG активен) ---
    if (useRAG && store && userMessageText && assistantResponse) {
        await store.addExchange(userMessageText, assistantResponse);
        console.log('💾 Exchange saved to RAG store');
    }

    // --- Ответ клиенту в формате OpenAI ---
    res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'deepseek-chat',
        choices: [{
            index: 0,
            message: { role: 'assistant', content: assistantResponse },
            finish_reason: 'stop'
        }],
        usage: {
            prompt_tokens: Math.ceil(finalPrompt.length / 4),
            completion_tokens: Math.ceil(assistantResponse.length / 4),
            total_tokens: Math.ceil((finalPrompt.length + assistantResponse.length) / 4)
        }
    });
    console.log(`✅ Response in ${Date.now() - startTime}ms`);
};