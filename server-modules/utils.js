const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY_FILE = process.env.DEEPSEEK_API_KEY_PATH || path.join(__dirname, '..', '.api-key');
const STATE_FILE = process.env.DEEPSEEK_STATE_PATH || path.join(__dirname, '..', 'state.json');
const SYSTEM_PROMPT_FILE = process.env.DEEPSEEK_SYSTEM_PROMPT_PATH || path.join(__dirname, '..', 'prompts', 'system_prompt.txt');

function generateApiKey() {
    return 'deepseek_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}

function getApiKey() {
    if (fs.existsSync(API_KEY_FILE)) {
        return fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
    }
    return null;
}

function saveApiKey(apiKey) {
    fs.writeFileSync(API_KEY_FILE, apiKey);
    console.log(`💾 API key saved to ${API_KEY_FILE}`);
}

function deleteSessionFiles() {
    if (fs.existsSync(API_KEY_FILE)) fs.unlinkSync(API_KEY_FILE);
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    console.log(`🗑️ Deleted session files`);
}

function bothFilesExist() {
    return fs.existsSync(API_KEY_FILE) && fs.existsSync(STATE_FILE);
}

function getSystemPrompt() {
    if (!fs.existsSync(SYSTEM_PROMPT_FILE)) {
        throw new Error(`System prompt file not found: ${SYSTEM_PROMPT_FILE}`);
    }
    return fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf-8');
}

// ИЗМЕНЕНА: теперь принимает массив messages, а не строку
function buildPrompt(messages, tools) {
    let conversationText = '';

    // Проверяем, нужно ли добавлять префиксы ролей
    const hasSystem = messages.some(m => m.role === 'system');
    const hasMultiple = messages.length > 1;
    const needPrefixes = hasSystem || hasMultiple;

    if (!needPrefixes && messages.length === 1 && messages[0].role === 'user') {
        // Обратная совместимость: одно сообщение user без префикса
        conversationText = messages[0].content;
    } else {
        // Полная история с префиксами
        for (const msg of messages) {
            switch (msg.role) {
                case 'system':
                    conversationText += `System: ${msg.content}\n`;
                    break;
                case 'user':
                    conversationText += `User: ${msg.content}\n`;
                    break;
                case 'assistant':
                    conversationText += `Assistant: ${msg.content}\n`;
                    break;
                default:
                    conversationText += `${msg.role}: ${msg.content}\n`;
            }
        }
    }

    // Добавляем описание tools, если они есть
    let toolsText = '';
    if (tools && tools.length) {
        toolsText = `\n\nTools available (JSON):\n${JSON.stringify(tools, null, 2)}\n\n` +
                    `When you need to use a tool, respond with ONLY JSON: {"tool_calls": [{"name": "...", "arguments": {...}}]}\n\n`;
    }

    return toolsText + conversationText;
}

module.exports = {
    generateApiKey,
    getApiKey,
    saveApiKey,
    deleteSessionFiles,
    bothFilesExist,
    getSystemPrompt,
    buildPrompt
};