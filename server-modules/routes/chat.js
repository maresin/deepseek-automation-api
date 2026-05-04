// server-modules/routes/chat.js
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
    const { messages, tools, extra_body, file } = req.body;
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    const apiKey = req.headers.authorization?.replace('Bearer ', '') || 'default';
    global.currentApiKey = apiKey;

    // RAG store всегда инициализируется, если RAG включён
    let store = null;
    if (process.env.ENABLE_RAG === 'true') {
        try {
            store = await getHistoryStore(apiKey);
        } catch (err) {
            console.warn('RAG store not available:', err);
        }
    }

    // Поиск (обогащение запроса) используем только после перехода в новый чат
    const useSearchRAG = process.env.ENABLE_RAG === 'true' && client.inRefreshedChat === true && store !== null;

    const userMessage = messages.filter(m => m.role === 'user').pop();
    if (!userMessage && !file) {
        return res.status(400).json({ error: 'No user message or file provided' });
    }

    let userText = userMessage ? userMessage.content : '';

    console.log(`🔍 RAG search: useSearchRAG=${useSearchRAG}, store=${!!store}, inRefreshedChat=${client.inRefreshedChat}, currentChatId=${client.currentChatId}`);
    if (useSearchRAG && store) {
        const results = await store.search(userText, client.currentChatId, 10);
        console.log(`🔍 Search returned ${results.length} results`);
    }

    // --- RAG: обогащение запроса (только после перехода, с ограничением длины) ---
    if (useSearchRAG && userText) {
        try {
            const results = await store.search(userText, client.currentChatId, 5);
            if (results.length > 0) {
                const MAX_CONTEXT_CHARS = 1500;
                let contextBlocks = [];
                let currentLen = 0;
                for (const r of results) {
                    let block = '';
                    if (r.item.type === 'exchange') {
                        // Берём только последние 300 символов ответа ассистента
                        const snippet = r.item.assistant.slice(-300);
                        block = `Previous: ...${snippet}`;
                    } else if (r.item.type === 'file') {
                        block = `[File ${r.item.fileName}]: ${r.item.content.slice(0, 200)}`;
                    }
                    if (currentLen + block.length <= MAX_CONTEXT_CHARS) {
                        contextBlocks.push(block);
                        currentLen += block.length;
                    } else break;
                }
                if (contextBlocks.length) {
                    const contextSection = `Relevant previous conversation:\n${contextBlocks.join('\n---\n')}\n\n---\n\n`;
                    // Не добавляем, если общий размер превышает 4000 символов
                    if (userText.length + contextSection.length < 4000) {
                        userText = contextSection + userText;
                        console.log(`📚 Enriched prompt with ${contextBlocks.length} short fragment(s) (total ${currentLen} chars)`);
                    } else {
                        console.log(`⚠️ User message too long (${userText.length} chars), skipping enrichment`);
                    }
                }
            }
        } catch (err) {
            console.error('RAG search failed:', err);
        }
    }

    // Обработка файла
    let tempFilePath = null;
    if (file) {
        const ext = path.extname(file.originalname);
        tempFilePath = path.join(process.cwd(), 'uploads', `${Date.now()}${ext}`);
        fs.renameSync(file.path, tempFilePath);
    }

    const prompt = userText ? buildPrompt(userText, tools) : '';
    console.log(`📤 Question: ${userText?.substring(0, 100) || 'No text'}...`);
    if (tools?.length) console.log(`🔧 Tools: ${tools.map(t => t.function.name).join(', ')}`);
    if (file) console.log(`📎 File included: ${file.originalname}`);

    // Очередь задач
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

    const userTask = new SendUserMessageTask(prompt, tempFilePath);
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

    // --- Сохранение обмена в RAG (ВСЕГДА, если store доступен) ---
    if (store && userMessage && result) {
        await store.addExchange(client.currentChatId, userMessage.content, result);
        console.log('💾 Exchange saved to RAG store');
    }

    // Очистка временного файла
    if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
    }

    // Ответ OpenAI
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
            choices: [{
                index: 0,
                message: { role: 'assistant', content: null, tool_calls: toolCalls },
                finish_reason: 'tool_calls'
            }],
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
            choices: [{
                index: 0,
                message: { role: 'assistant', content: parsedResponse.content || result },
                finish_reason: 'stop'
            }],
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