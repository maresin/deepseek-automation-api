// server-modules/utils.js
const fs = require('fs');
const path = require('path');
const { loadPrompt } = require('../dist/utils/prompts.js')
require('dotenv').config();

const API_KEY_FILE = process.env.DEEPSEEK_API_KEY_PATH || path.join(__dirname, '..', '.api-key');
const STATE_FILE = process.env.DEEPSEEK_STATE_PATH || path.join(__dirname, '..', 'state.json');
const CHAT_STATE_FILE = process.env.DEEPSEEK_CHAT_STATE_PATH || path.join(__dirname, '..', 'chat_state.json');

/**
 * Generate a unique API key for the current session.
 * @returns {string} API key in the form `deepseek_<timestamp>_<random>`.
 */
function generateApiKey() {
    return 'deepseek_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Read the stored API key from disk.
 * @returns {string|null} The API key, or null if the file is absent.
 */
function getApiKey() {
    if (fs.existsSync(API_KEY_FILE)) {
        return fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
    }
    return null;
}

/**
 * Persist the API key to disk.
 * @param {string} apiKey - API key to store.
 */
function saveApiKey(apiKey) {
    fs.writeFileSync(API_KEY_FILE, apiKey);
    console.log(`💾 API key saved to ${API_KEY_FILE}`);
}

/**
 * Remove all session files: API key, browser state, and chat state.
 * Called when a session is invalidated and needs to be recreated.
 */
function deleteSessionFiles() {
    if (fs.existsSync(API_KEY_FILE)) fs.unlinkSync(API_KEY_FILE);
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(CHAT_STATE_FILE)) fs.unlinkSync(CHAT_STATE_FILE);
    console.log(`🗑️ Deleted session files`);
}

/**
 * Check whether a restorable session exists on disk.
 * A session is considered restorable when both the API key and the
 * browser state file are present. Chat state is optional (a freshly
 * registered session has no chat history yet).
 * @returns {boolean}
 */
function bothFilesExist() {
    return fs.existsSync(API_KEY_FILE) && fs.existsSync(STATE_FILE);
}

/**
 * Read the system prompt from disk.
 * @throws {Error} If the system prompt file does not exist.
 * @returns {string} Contents of the system prompt file.
 */
function getSystemPrompt() {
    const pathOrName = process.env.DEEPSEEK_SYSTEM_PROMPT_PATH || 'system_prompt.txt';
    return loadPrompt(pathOrName, { required: true });
}

/**
 * Build the prompt text sent to DeepSeek from a messages array.
 *
 * Role prefixes (`System:`, `User:`, `Assistant:`) are added when the
 * conversation has more than one message, or when a system message is
 * present. A single user message without history is sent as-is for
 * backward compatibility.
 *
 * When tools are provided, a JSON tool description block is prepended
 * with instructions on how to emit tool calls.
 *
 * @param {Array<{role: string, content: string}>} messages - Conversation messages.
 * @param {Array<object>} [tools] - OpenAI-style tool definitions.
 * @returns {string} Prompt text ready to be typed into the DeepSeek UI.
 */
function buildPrompt(messages, tools) {
    let conversationText = '';

    const hasSystem = messages.some(m => m.role === 'system');
    const hasMultiple = messages.length > 1;
    const needPrefixes = hasSystem || hasMultiple;

    if (!needPrefixes && messages.length === 1 && messages[0].role === 'user') {
        conversationText = messages[0].content;
    } else {
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