const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { buildPrompt } = require('../utils');
const { getHistoryStore } = require('../../dist/rag/init.js');

const {
    SwitchExpertModeTask,
    SwitchDeepThinkTask,
    SwitchWebSearchTask,
    SendUserMessageTask
} = require('../../dist');

module.exports = async function chatRoute(req, res) {
    const startTime = Date.now();
    const { messages, tools, extra_body, files } = req.body; // files - массив
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    const apiKey = req.headers.authorization?.replace('Bearer ', '') || 'default';
    global.currentApiKey = apiKey;

    let store = null;
    if (process.env.ENABLE_RAG === 'true') {
        try {
            store = await getHistoryStore(apiKey);
        } catch (err) {
            console.warn('RAG store not available:', err);
        }
    }
    const useSearchRAG = process.env.ENABLE_RAG === 'true' && client.inRefreshedChat === true && store !== null;

    const userMessage = messages.filter(m => m.role === 'user').pop();
    if (!userMessage && (!files || files.length === 0)) {
        return res.status(400).json({ error: 'No user message or files provided' });
    }

    let userText = userMessage ? userMessage.content : '';

    // --- RAG обогащение (без изменений) ---
    if (useSearchRAG && userText) {
        try {
            const results = await store.search(userText, client.currentChatId, 15);
            if (results.length > 0) {
                const exchangeMap = new Map();
                for (const r of results) {
                    if (r.item.type === 'exchange') {
                        const key = `${r.item.user}||${r.item.assistant}`;
                        if (!exchangeMap.has(key)) exchangeMap.set(key, []);
                        exchangeMap.get(key).push(r.item);
                    }
                }
                const contextBlocks = [];
                for (const chunks of exchangeMap.values()) {
                    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
                    const fullCombined = chunks.map(c => c.combined).join('');
                    const user = chunks[0].user;
                    const assistant = chunks[0].assistant;
                    contextBlocks.push(`User: ${user}\nAssistant: ${assistant}\n---\n${fullCombined}`);
                }
                for (const r of results) {
                    if (r.item.type === 'file') {
                        contextBlocks.push(`[From file ${r.item.fileName}]: ${r.item.content.substring(0, 800)}`);
                    }
                }
                if (contextBlocks.length) {
                    userText = `Relevant previous conversation:\n${contextBlocks.join('\n---\n')}\n\n---\n\n${userText}`;
                    console.log(`📚 Enriched prompt with ${exchangeMap.size} exchange(s) and ${results.filter(r => r.item.type === 'file').length} file chunk(s)`);
                }
            }
        } catch (err) {
            console.error('RAG search failed:', err);
        }
    }

    // --- Сохраняем загруженные файлы во временные файлы ---
    const tempFilePaths = [];
    if (files && files.length) {
        for (const file of files) {
            const ext = path.extname(file.originalname);
            const tempPath = path.join(process.cwd(), 'uploads', `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
            fs.renameSync(file.path, tempPath);
            tempFilePaths.push(tempPath);
        }
    }

    const prompt = userText ? buildPrompt(userText, tools) : '';
    console.log(`📤 Question: ${userText?.substring(0, 100) || 'No text'}...`);
    if (tools?.length) console.log(`🔧 Tools: ${tools.map(t => t.function.name).join(', ')}`);
    if (tempFilePaths.length) console.log(`📎 Files included: ${tempFilePaths.map(p => path.basename(p)).join(', ')}`);

    // --- Очередь задач ---
    const tasksToAdd = [];
    if (extra_body?.expert_mode !== undefined && !client.isChatStarted()) {
        tasksToAdd.push(new SwitchExpertModeTask(extra_body.expert_mode));
    }
    if (extra_body?.deepthink !== undefined) {
        tasksToAdd.push(new SwitchDeepThinkTask(extra_body.deepthink));
    }
    if (extra_body?.web_search !== undefined) {
        tasksToAdd.push(new SwitchWebSearchTask(extra_body.web_search));
    }

    const userTask = new SendUserMessageTask(prompt, tempFilePaths);
    tasksToAdd.push(userTask);

    let result;
    for (let i = 0; i < tasksToAdd.length; i++) {
        const task = tasksToAdd[i];
        if (i === tasksToAdd.length - 1) {
            result = await client.taskQueue.add(task);
        } else {
            await client.taskQueue.add(task);
        }
    }

    // Сохранение в RAG
    if (store && userMessage && result) {
        await store.addExchange(client.currentChatId, userMessage.content, result);
        console.log('💾 Exchange saved to RAG store');
    }

    // Очистка временных файлов
    for (const p of tempFilePaths) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // --- Формирование ответа (как было) ---
    let parsedResponse, isToolCall = false;
    try {
        parsedResponse = JSON.parse(result);
        if (parsedResponse.tool_calls?.length) isToolCall = true;
    } catch (e) {
        parsedResponse = { content: result };
    }

    let openaiResponse;
    if (isToolCall) {
        const toolCalls = parsedResponse.tool_calls.map((tc, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }));
        openaiResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'deepseek-chat',
            choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
            usage: {
                prompt_tokens: Math.ceil(prompt.length / 4),
                completion_tokens: Math.ceil(result.length / 4),
                total_tokens: Math.ceil((prompt.length + result.length) / 4)
            }
        };
    } else {
        openaiResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'deepseek-chat',
            choices: [{ index: 0, message: { role: 'assistant', content: parsedResponse.content || result }, finish_reason: 'stop' }],
            usage: {
                prompt_tokens: Math.ceil(prompt.length / 4),
                completion_tokens: Math.ceil(result.length / 4),
                total_tokens: Math.ceil((prompt.length + result.length) / 4)
            }
        };
    }

    console.log(`✅ Response sent in ${Date.now() - startTime}ms`);
    res.json(openaiResponse);
};