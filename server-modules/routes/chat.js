const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { buildPrompt } = require('../utils');
const { RagManager } = require('../rag-manager.js');

// Глобальные хранилища
const ragSessions = (global).__ragSessions || new Map();
global.__ragSessions = ragSessions;
const ragFlags = new Map(); // apiKey -> boolean (useRAG)

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

// Описание инструмента search_conversation
const ragTool = {
    type: "function",
    function: {
        name: "search_conversation",
        description: "Search previous conversation history or uploaded file contents for relevant information. Call this when you need to recall past messages or details from files.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query describing what information you need" }
            },
            required: ["query"]
        }
    }
};

async function sendToDeepSeek(client, prompt, filePath) {
    const { SendUserMessageTask } = require('../../dist/tasks/SendUserMessageTask.js');
    const task = new SendUserMessageTask(prompt, filePath);
    const result = await client.taskQueue.add(task);
    return result;
}

module.exports = async function chatRoute(req, res) {
    const startTime = Date.now();
    const { messages, tools, extra_body, file } = req.body;
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    const apiKey = req.headers.authorization?.replace('Bearer ', '') || 'default';
    const rag = getRagManager(apiKey);
    const useRAG = getUseRAG(apiKey);

    // Извлекаем последнее сообщение пользователя
    const userMessage = messages.filter(m => m.role === 'user').pop();
    if (!userMessage && !file) return res.status(400).json({ error: 'No user message or file provided' });

    // Формируем список инструментов (добавляем RAG-инструмент, если RAG активен)
    let allTools = tools ? [...tools] : [];
    if (useRAG) {
        allTools.push(ragTool);
    }

    const features = {
        deepThink: extra_body?.deepthink || false,
        webSearch: extra_body?.web_search || false,
        expertMode: extra_body?.expert_mode || false
    };

    const prompt = userMessage ? buildPrompt(userMessage.content, allTools) : "";
    console.log(`📤 Question: ${userMessage?.content?.substring(0, 100) || "No text"}...`);
    if (allTools?.length) console.log(`🔧 Tools: ${allTools.map(t => t.function.name).join(', ')}`);
    if (file) console.log(`📎 File included: ${file.originalname}`);

    // Временный файл
    let tempFilePath = null;
    if (file) {
        const ext = path.extname(file.originalname);
        tempFilePath = path.join(process.cwd(), 'uploads', `${Date.now()}${ext}`);
        fs.renameSync(file.path, tempFilePath);
    }

    // Сохраняем запрос пользователя в RAG-историю (если RAG включён)
    if (rag && userMessage?.content) {
        await rag.addMessage('user', userMessage.content);
    }

    // --- Цикл обработки tool_calls ---
    let currentPrompt = prompt;
    let currentFilePath = tempFilePath;
    let finalResult = null;
    let iteration = 0;
    const maxIterations = 5;

    while (iteration < maxIterations && !finalResult) {
        iteration++;
        const result = await sendToDeepSeek(client, currentPrompt, currentFilePath);
        let parsed;
        try { parsed = JSON.parse(result); } catch(e) { parsed = { content: result }; }

        if (useRAG && parsed.tool_calls && parsed.tool_calls.length > 0) {
            // Обрабатываем только search_conversation
            let toolMessages = [];
            for (const tc of parsed.tool_calls) {
                if (tc.function.name === 'search_conversation') {
                    let query = '';
                    try {
                        query = JSON.parse(tc.function.arguments).query;
                    } catch (err) {
                        query = '';
                    }
                    if (rag && query) {
                        const searchResults = await rag.search(query, 5);
                        const resultText = searchResults.map(r => {
                            if (r.type === 'message') return `[${r.role}]: ${r.content}`;
                            else return `[File ${r.file}]: ${r.content}`;
                        }).join('\n---\n');
                        toolMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: resultText || "No relevant information found."
                        });
                    } else {
                        toolMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: "RAG not available or query empty."
                        });
                    }
                } else {
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: `Tool ${tc.function.name} not implemented.`
                    });
                }
            }
            // Формируем новый промпт с результатами вызовов
            const newMessages = [
                { role: 'assistant', content: null, tool_calls: parsed.tool_calls },
                ...toolMessages
            ];
            currentPrompt = `Previous assistant called tools. Results:\n${toolMessages.map(tm => tm.content).join('\n')}\n\nOriginal user request: ${userMessage?.content}\nPlease continue based on this information.`;
            currentFilePath = null;
            continue;
        } else {
            finalResult = result;
            break;
        }
    }

    if (!finalResult) finalResult = 'Max iterations reached without final answer.';

    // Сохраняем ответ ассистента в RAG-историю
    if (rag && finalResult) {
        let contentToSave = finalResult;
        try {
            const parsed = JSON.parse(finalResult);
            if (parsed.content) contentToSave = parsed.content;
        } catch(e) {}
        await rag.addMessage('assistant', contentToSave);
    }

    // Очистка временного файла
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    // Формирование OpenAI-ответа (как было)
    let parsedResponse, isToolCall = false;
    try {
        parsedResponse = JSON.parse(finalResult);
        if (parsedResponse.tool_calls?.length) isToolCall = true;
    } catch(e) { parsedResponse = { content: finalResult }; }

    let openaiResponse;
    if (isToolCall) {
        const toolCalls = parsedResponse.tool_calls.map((tc, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: "function",
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
                completion_tokens: Math.ceil(finalResult.length / 4),
                total_tokens: Math.ceil((prompt.length + finalResult.length) / 4)
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
                message: { role: 'assistant', content: parsedResponse.content || finalResult },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: Math.ceil(prompt.length / 4),
                completion_tokens: Math.ceil(finalResult.length / 4),
                total_tokens: Math.ceil((prompt.length + finalResult.length) / 4)
            }
        };
    }
    console.log(`✅ Response sent in ${Date.now() - startTime}ms`);
    res.json(openaiResponse);
};

// Экспортируем функции для управления флагом RAG извне (например, из tasks/SendUserMessageTask)
module.exports.setUseRAG = setUseRAG;
module.exports.getUseRAG = getUseRAG;