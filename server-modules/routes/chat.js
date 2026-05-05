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

function truncateFromEnd(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
}

module.exports = async function chatRoute(req, res) {
    const startTime = Date.now();
    const { messages, tools, extra_body, file } = req.body;
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
    if (!userMessage && !file) return res.status(400).json({ error: 'No user message or file provided' });

    const originalUserText = userMessage ? userMessage.content : '';
    let finalUserText = originalUserText;

    if (useSearchRAG && originalUserText) {
        try {
            const results = await store.search(originalUserText, client.currentChatId, 15);
            if (results.length > 0) {
                const exchangeMap = new Map();
                for (const r of results) {
                    if (r.item.type === 'exchange') {
                        const key = `${r.item.chatId}|${r.item.user}|${r.item.assistant}`;
                        if (!exchangeMap.has(key)) exchangeMap.set(key, []);
                        exchangeMap.get(key).push(r.item);
                    }
                }
                const fullAnswers = [];
                const MAX_FRAGMENT_CHARS = parseInt(process.env.RAG_FRAGMENT_MAX_CHARS || '1200', 10);
                for (const chunks of exchangeMap.values()) {
                    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
                    const fullCombined = chunks.map(c => c.combined).join('');
                    let assistantPart = fullCombined;
                    if (fullCombined.includes('\nA: ')) assistantPart = fullCombined.split('\nA: ')[1];
                    assistantPart = truncateFromEnd(assistantPart, MAX_FRAGMENT_CHARS);
                    fullAnswers.push(assistantPart);
                }
                if (fullAnswers.length) {
                    const searchResults = {
                        query: originalUserText,
                        fragments: fullAnswers.map((content, idx) => ({ id: idx + 1, content }))
                    };
                    const jsonBlock = JSON.stringify(searchResults, null, 2);
                    const instruction = `I have retrieved relevant previous conversation fragments. Use them if they help answer the user's question.\n\n<search_results>\n${jsonBlock}\n</search_results>\n\nNow answer the user's question: ${originalUserText}`;
                    finalUserText = instruction;
                    console.log(`📚 RAG: added ${fullAnswers.length} unique fragment(s) (total ~${jsonBlock.length} chars)`);
                }
            }
        } catch (err) {
            console.error('RAG search failed:', err);
        }
    }

    let userFilePath = null;
    if (file) {
        const ext = path.extname(file.originalname);
        userFilePath = path.join(process.cwd(), 'uploads', `${Date.now()}${ext}`);
        fs.renameSync(file.path, userFilePath);
    }

    const prompt = buildPrompt(finalUserText, tools);
    console.log(`📤 Question: ${originalUserText.substring(0, 100) || 'No text'}...`);
    if (tools?.length) console.log(`🔧 Tools: ${tools.map(t => t.function.name).join(', ')}`);
    if (userFilePath) console.log(`📎 User file: ${file.originalname}`);

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

    const userTask = new SendUserMessageTask(prompt, userFilePath);
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

    if (store && userMessage && result) {
        await store.addExchange(client.currentChatId, originalUserText, result);
        console.log('💾 Exchange saved to RAG store');
    }

    if (userFilePath && fs.existsSync(userFilePath)) fs.unlinkSync(userFilePath);

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