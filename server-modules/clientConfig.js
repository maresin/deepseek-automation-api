// server-modules/clientConfig.js
require('dotenv').config();

function getClientConfig(overrides = {}) {
    return {
        headless: process.env.DEEPSEEK_HEADLESS === 'true',
        showBrowser: process.env.DEEPSEEK_SHOW_BROWSER === 'true',
        strategy: 'auto',
        statePath: process.env.DEEPSEEK_STATE_PATH || './state.json',
        email: process.env.DEEPSEEK_EMAIL,
        password: process.env.DEEPSEEK_PASSWORD,
        restoreSession: process.env.DEEPSEEK_RESTORE_SESSION === 'true',
        ...overrides
    };
}

module.exports = { getClientConfig };