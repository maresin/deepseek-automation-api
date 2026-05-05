// server-modules/middleware.js
const rateLimit = require('express-rate-limit');
const { getApiKey } = require('./utils');
const { isReady } = require('./state');

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: { error: 'Too many requests' } });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Chat rate limit exceeded' } });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Upload rate limit exceeded' } });

async function authenticate(req, res, next) {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'Missing API key' });
    const savedKey = getApiKey();
    if (!savedKey || apiKey !== savedKey) return res.status(401).json({ error: 'Invalid API key' });
    if (!isReady()) {
        return res.status(503).json({ error: 'Client not ready. Please register first: POST /v1/register' });
    }
    next();
}

module.exports = {
    globalLimiter,
    chatLimiter,
    uploadLimiter,
    authenticate
};