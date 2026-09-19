// server-modules/clientConfig.js
require('dotenv').config();

/**
 * Build the configuration object passed to DeepSeekClient.
 *
 * Only fields actually consumed by DeepSeekClient are included:
 *   - headless       : run Chromium headless (from DEEPSEEK_HEADLESS)
 *   - statePath      : path to browser state file (cookies + origins)
 *   - chatStatePath  : path to chat session state file
 *                      (lastChatId, chatStarted, totalChars, ragSearchActive)
 *   - email          : DeepSeek account email for auto-login
 *   - password       : DeepSeek account password for auto-login
 *
 * Feature flags (ENABLE_RESTORE, ENABLE_SNAPSHOT, ENABLE_RAG) are read
 * directly from process.env inside the client and are NOT part of this config.
 *
 * @param {object} overrides - fields to override (e.g. email/password from a
 *                             register request, or systemPrompt from utils).
 * @returns {object} config object for DeepSeekClient.
 */
function getClientConfig(overrides = {}) {
    return {
        headless: process.env.DEEPSEEK_HEADLESS === 'true',
        statePath: process.env.DEEPSEEK_STATE_PATH || './state.json',
        chatStatePath: process.env.DEEPSEEK_CHAT_STATE_PATH || './chat_state.json',
        email: process.env.DEEPSEEK_EMAIL,
        password: process.env.DEEPSEEK_PASSWORD,
        ...overrides,
    };
}

module.exports = { getClientConfig };