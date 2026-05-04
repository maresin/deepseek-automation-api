const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { buildPrompt } = require('../utils');
const { RagManager } = require('../rag-manager.js');

const ragSessions = new Map();
const ragFlags = new Map();

function getRagManager(apiKey) {
    if (process.env.ENABLE_RAG !== 'true') return null;
    if (!ragSessions.has(apiKey)) {
        ragSessions.set(apiKey, new RagManager(apiKey));
    }
    return ragSessions.get(apiKey);
}

function setUseRAG(apiKey, value) {
    ragFlags.set(apiKey, value);
}

function getUseRAG(apiKey) {
    return ragFlags.get(apiKey) || false;
}

async function sendToDeepSeek(client, prompt, filePath) {
    const { SendUserMessageTask } = require('../../dist/tasks/SendUserMessageTask.js');
    const task = new SendUserMessageTask(prompt, filePath);
    return await client.taskQueue.add(task);
}

module.exports = async function chatRoute(req, res) {
    const startTime = Date.now();
    const { messages, tools, extra_body, file } = req.body;
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    const apiKey = req.headers.authorization?.replace('Bearer ', '') || 'default';
    // Делаем apiKey доступным для SendUserMessageTask (костыль)
    global.currentApiKey = apiKey;

    const rag = getRagManager(apiKey);
    const useRAG = getUseRAG(apiKey);

    const userMessage = messages.find(m => m.role === 'user');
    if (!userMessage && !file) return res.status(400).json({ error: 'No user message or file provided' });

    // --- Автоматический поиск в истории (RAG) ---
    let finalUserContent = userMessage?.content || '';
    if (useRAG && rag && userMessage?.content) {
        console.log(`🔍 Auto-RAG: searching for "${userMessage.content.substring(0, 80)}..."`);
        const results = await rag.search(userMessage.content, 5);
        if (results.length > 0) {
            const context = results.map(r => r.type === 'message'
                ? `[${r.role}]: ${r.content}`
                : `[File ${r.file}]: ${r.content}`
            ).join('\n---\n');
            finalUserContent = `Relevant history:\n${context}\n\n---\n\n${userMessage.content}`;
            console.log(`✅ Auto-RAG: added ${results.length} fragments`);
        } else {
            console.log(`ℹ️ Auto-RAG: no relevant fragments`);
        }
    }
    // ------------------------------------------

    const allTools = tools ? [...tools] : [];
    const prompt = buildPrompt(finalUserContent, allTools);

    console.log(`📤 Original: ${userMessage?.content?.substring(0, 100)}`);
    if (allTools.length) console.log(`🔧 Tools: ${allTools.map(t => t.function.name).join(', ')}`);
    if (file) console.log(`📎 File: ${file.originalname}`);

    let tempFilePath = null;
    if (file) {
        const ext = path.extname(file.originalname);
        tempFilePath = path.join(process.cwd(), 'uploads', `${Date.now()}${ext}`);
        fs.renameSync(file.path, tempFilePath);
    }

    if (rag && userMessage?.content) {
        await rag.addMessage('user', userMessage.content);
    }

    const finalResult = await sendToDeepSeek(client, prompt, tempFilePath);

    if (rag && finalResult) {
        let content = finalResult;
        try { content = JSON.parse(finalResult).content || finalResult; } catch(e) {}
        await rag.addMessage('assistant', content);
    }

    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    let parsed;
    try { parsed = JSON.parse(finalResult); } catch(e) { parsed = { content: finalResult }; }

    res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'deepseek-chat',
        choices: [{
            index: 0,
            message: { role: 'assistant', content: parsed.content || finalResult },
            finish_reason: 'stop'
        }],
        usage: {
            prompt_tokens: Math.ceil(prompt.length / 4),
            completion_tokens: Math.ceil(finalResult.length / 4),
            total_tokens: Math.ceil((prompt.length + finalResult.length) / 4)
        }
    });
    console.log(`✅ Response in ${Date.now() - startTime}ms`);
};

module.exports.setUseRAG = setUseRAG;
module.exports.getUseRAG = getUseRAG;