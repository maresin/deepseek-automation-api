// server-modules/utils.js
const fs = require('fs');
const path = require('path');
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
        // Only the current tool schema goes here. The format instructions
        // (pretty-printed JSON, no markdown fences, etc.) live in
        // prompts/tools_prompt.txt and are sent once per session by
        // SendUserMessageTask.ensureToolsPrompt.
        toolsText = `\n\nTools available (JSON):\n${JSON.stringify(tools, null, 2)}\n\n`;
    }

    return toolsText + conversationText;
}

/**
 * Sanitize a client-supplied filename for use as a filesystem basename.
 *
 * Removes path separators, control characters, and Windows-forbidden
 * characters. Keeps Unicode letters (Cyrillic, CJK, accented Latin) so
 * the original name is preserved visually.
 *
 * @param {string} name - Original filename from the client.
 * @returns {string} Safe basename (at least one character).
 */
function sanitizeFilename(name) {
    if (!name || typeof name !== 'string') return 'file';

    // Strip any directory components (Windows and POSIX separators).
    let base = name.replace(/^.*[\\/]/, '');

    // Remove control characters and characters forbidden on Windows.
    base = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '');

    // Trim leading/trailing dots and spaces.
    base = base.replace(/^[.\s]+|[.\s]+$/g, '');

    if (!base || base === '.' || base === '..') return 'file';

    // Cap length to avoid filesystem limits (255 bytes typical).
    if (Buffer.byteLength(base, 'utf8') > 200) {
        const ext = path.extname(base);
        while (Buffer.byteLength(base, 'utf8') > 200 && base.length > ext.length) {
            base = base.slice(0, -1);
        }
    }

    return base;
}

/**
 * Fix filenames that multer decodes as latin1.
 *
 * Busboy (used by multer) decodes the multipart `filename` header as
 * latin1 regardless of the client's declared charset. When the client
 * sends a UTF-8 filename (Cyrillic, CJK, accented Latin), the bytes
 * end up as mojibake: "отчёт.txt" becomes "Ð¾Ñ‚Ñ‡Ñ'Ñ‚.txt".
 *
 * Reinterpreting the string as latin1 bytes and decoding them as UTF-8
 * restores the original name. The round-trip check ensures we only
 * apply the conversion when it is actually reversible — a filename
 * that was already correct stays untouched.
 *
 * @param {string} name - Original filename from multer.
 * @returns {string} Decoded filename.
 */
function decodeOriginalName(name) {
    if (!name || typeof name !== 'string') return name;

    try {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        // If re-encoding the decoded string back to latin1 produces the
        // original, the conversion was lossless — meaning the input was
        // mojibake, not a real latin1 name.
        if (Buffer.from(decoded, 'utf8').toString('latin1') === name) {
            return decoded;
        }
    } catch { /* ignore */ }

    return name;
}

/**
 * Build a unique path inside a directory by appending `_1`, `_2`, ...
 * if the target already exists. Preserves the extension.
 *
 * @param {string} dir - Target directory (must exist).
 * @param {string} name - Desired basename.
 * @returns {string} Absolute path that does not yet exist.
 */
function uniquePath(dir, name) {
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let candidate = path.join(dir, name);
    let i = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${stem}_${i}${ext}`);
        i++;
    }
    return candidate;
}

module.exports = {
    generateApiKey,
    getApiKey,
    saveApiKey,
    deleteSessionFiles,
    bothFilesExist,
    buildPrompt,
    sanitizeFilename,
    uniquePath,
    decodeOriginalName,
};