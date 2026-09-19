// server-modules/middleware.js
/**
 * @file server-modules/middleware.js
 * Express middleware: rate limiters and API key authentication.
 *
 * Three limiters are exported:
 *   - globalLimiter : applied to every route, 100 requests per minute
 *   - chatLimiter   : for /v1/chat/completions, 30 per minute
 *   - uploadLimiter : for /v1/files and its variants, 10 per minute
 *
 * The `authenticate` middleware validates the Bearer token against the
 * stored API key and rejects requests when the DeepSeek client has not
 * finished initializing.
 */

const rateLimit = require('express-rate-limit');
const { getApiKey } = require('./utils');
const { isReady } = require('./state');

/**
 * Global rate limiter. Applies to every request regardless of route.
 * @type {import('express-rate-limit').RateLimitRequestHandler}
 */
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Too many requests' },
});

/**
 * Rate limiter for the chat completions route.
 * @type {import('express-rate-limit').RateLimitRequestHandler}
 */
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Chat rate limit exceeded' },
});

/**
 * Rate limiter for file upload routes.
 * @type {import('express-rate-limit').RateLimitRequestHandler}
 */
const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Upload rate limit exceeded' },
});

/**
 * Authenticate the request by comparing its Bearer token against the
 * stored API key.
 *
 * On success, calls next(). On failure, responds directly:
 *   - 401 if the Authorization header is missing or the key is wrong
 *   - 503 if the API key matches but the DeepSeek client is not ready
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function authenticate(req, res, next) {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) {
        return res.status(401).json({ error: 'Missing API key' });
    }

    const savedKey = getApiKey();
    if (!savedKey || apiKey !== savedKey) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    if (!isReady()) {
        return res.status(503).json({
            error: 'Client not ready. Please register first: POST /v1/register',
        });
    }

    next();
}

module.exports = {
    globalLimiter,
    chatLimiter,
    uploadLimiter,
    authenticate,
};