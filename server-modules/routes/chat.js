// server-modules/routes/chat.js
const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { buildPrompt } = require('../utils');

// Импортируем классы задач из собранного дистрибутива
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
    if (!client) {
        return res.status(503).json({ error: 'Client not ready' });
    }

    // Извлекаем последнее сообщение пользователя
    const userMessage = messages.filter(m => m.role === 'user').pop();
    if (!userMessage && !file) {
        return res.status(400).json({ error: 'No user message or file provided' });
    }

    const features = {
        deepThink: extra_body?.deepthink || false,
        webSearch: extra_body?.web_search || false,
        expertMode: extra_body?.expert_mode || false
    };

    // Формируем текст с учётом tools
    const prompt = userMessage ? buildPrompt(userMessage.content, tools) : "";
    console.log(`📤 Question: ${userMessage?.content?.substring(0, 100) || "No text"}...`);
    if (tools?.length) console.log(`🔧 Tools: ${tools.map(t => t.function.name).join(', ')}`);
    if (file) console.log(`📎 File included: ${file.originalname}`);

    let tempFilePath = null;
    if (file) {
        const ext = path.extname(file.originalname);
        tempFilePath = path.join(process.cwd(), 'uploads', `${Date.now()}${ext}`);
        fs.renameSync(file.path, tempFilePath);
    }

    // Собираем задачи в правильном порядке
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

    // Последовательно выполняем все задачи, дожидаемся только последней (ответа)
    let result;
    for (let i = 0; i < tasksToAdd.length; i++) {
        const task = tasksToAdd[i];
        if (i === tasksToAdd.length - 1) {
            result = await client.taskQueue.add(task);
        } else {
            await client.taskQueue.add(task);
        }
    }

    // Чистим временный файл
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    // Формируем OpenAI-совместимый ответ (без изменений)
    let parsedResponse, isToolCall = false;
    try {
        parsedResponse = JSON.parse(result);
        if (parsedResponse.tool_calls?.length) isToolCall = true;
    } catch(e) { parsedResponse = { content: result }; }

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