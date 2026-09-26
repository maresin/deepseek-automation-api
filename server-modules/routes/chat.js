// server-modules/routes/chat.js
/**
 * @file server-modules/routes/chat.js
 * Route handler for /v1/chat/completions.
 *
 * Processes user messages, applies feature toggles (DeepThink, WebSearch),
 * handles file uploads (both multipart and file_id), and, when RAG search
 * is active, retrieves relevant fragments from the index and attaches them
 * as a temporary text file. The retrieval is accompanied by a System-level
 * instruction (see prompts/rag_upload_prompt.txt) that teaches the model to
 * treat the attached file as an authoritative source.
 *
 * File indexing for RAG is deferred to a background queue (IndexingQueue)
 * so that the request returns to the client as soon as DeepSeek replies,
 * instead of waiting for CPU-bound embedding of potentially large files.
 */

const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { buildPrompt } = require('../utils');
const {
    sanitizeFilename,
    uniquePath,
    decodeOriginalName,
} = require('../utils.js');
const { loadPrompt } = require('../../dist/utils/prompts.js');
const { getHistoryStore } = require('../../dist/rag/init.js');
const { getIndexingQueue } = require('../../dist/rag/IndexingQueue.js');
const { isSupportedByDeepSeek } = require('../../dist/utils/fileUtils.js');
const { getUploadsDir } = require('../../dist/utils/paths.js');
const {
    normalizeToolCall,
    parseResponse,
} = require('../response-parser.js');
const { getFileInfo } = require('./files.js');

const {
    SwitchDeepThinkTask,
    SwitchWebSearchTask,
    SendUserMessageTask,
} = require('../../dist');

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_FILE_COUNT = 50;
const VALID_ROLES = new Set(['user', 'assistant', 'system']);

// ============================================================
// HELPERS
// ============================================================

/**
 * Collect all file_id values referenced in a messages array.
 */
function extractFileIdsFromMessages(messages) {
    const fileIds = [];
    if (!Array.isArray(messages)) return fileIds;
    for (const msg of messages) {
        if (!msg.content || typeof msg.content === 'string') continue;
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
            if (part.type === 'file' && part.file?.file_id) {
                fileIds.push(part.file.file_id);
            }
        }
    }
    return fileIds;
}

/**
 * Reduce messages to their text content, discarding non-text parts.
 */
function extractTextFromMessages(messages) {
    const textMessages = [];
    if (!Array.isArray(messages)) return textMessages;
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            textMessages.push(msg);
            continue;
        }
        if (!Array.isArray(msg.content)) continue;
        const textParts = [];
        for (const part of msg.content) {
            if (part.type === 'text') textParts.push(part.text);
        }
        if (textParts.length > 0) {
            textMessages.push({ ...msg, content: textParts.join('\n') });
        }
    }
    return textMessages;
}

/**
 * Cheap path safety check: reject paths whose basename contains ".."
 * or is empty.
 */
function isSafePath(filePath) {
    const base = path.basename(filePath);
    return base && !base.includes('..') && base.length > 0;
}

// ============================================================
// RESPONSE PARSING (tool_calls extraction)
// ============================================================
//
// Parsing, normalization, and truncation repair live in
// server-modules/response-parser.js so they can be unit-tested
// without a running server. See algorithms B8 and B9 in
// docs/algorithms/response.md.

// ============================================================
// VALIDATION
// ============================================================

function validateMessages(messages) {
    if (!Array.isArray(messages)) return 'messages must be an array';
    if (messages.length === 0) return 'messages cannot be empty';
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') return 'each message must be an object';
        if (!VALID_ROLES.has(msg.role)) {
            return `Invalid role: "${msg.role}". Must be one of: user, assistant, system`;
        }
        if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
            return `Invalid content type for role "${msg.role}": must be string or array`;
        }
    }
    return null;
}

function validateTools(tools) {
    if (tools === undefined) return null;
    if (!Array.isArray(tools)) return 'tools must be an array';
    for (const tool of tools) {
        if (!tool || typeof tool !== 'object') return 'each tool must be an object';
        if (tool.type !== 'function') return `Invalid tool type: "${tool.type}". Must be "function"`;
        if (!tool.function || typeof tool.function.name !== 'string') return 'each tool must have function.name';
    }
    return null;
}

function validateExtraBody(extra_body) {
    if (extra_body === undefined) return null;
    if (typeof extra_body !== 'object' || extra_body === null || Array.isArray(extra_body)) {
        return 'extra_body must be an object';
    }
    return null;
}

// ============================================================
// PUBLIC ROUTE
// ============================================================

module.exports = async function chatRoute(req, res) {
    try {
        await handleChatRoute(req, res);
    } catch (err) {
        console.error('❌ Chat route error:', err);

        if (err.name === 'ContextExhaustedError') {
            if (!res.headersSent) {
                const ragEnabled = !!err.ragEnabled;
                res.status(409).json({
                    error: {
                        type: 'context_exhausted',
                        message: 'DeepSeek context limit reached',
                        chat_id: err.chatId || null,
                        chars_used: err.charsUsed || 0,
                        chars_limit: err.charsLimit || 0,
                        deepseek_readable_percent: err.deepseekReadablePercent,
                        partial_response: err.partialResponse || null,
                        banner_text: err.bannerText || null,
                        rag_enabled: ragEnabled,
                        recovery: 'Call POST /v1/chat/new to start a new session. ' +
                            (ragEnabled
                                ? 'RAG index preserved; the next request will continue with search over previous history.'
                                : 'Prior context will be lost — it was not indexed for retrieval.'),
                    },
                });
            }
            return;
        }

        if (err.name === 'ServerBusyError') {
            if (!res.headersSent) {
                res.status(503).json({
                    error: {
                        type: 'server_busy',
                        message: 'DeepSeek backend is not responding. Server shutting down.',
                    },
                });
            }
            setTimeout(() => process.exit(1), 500);
            return;
        }

        if (!res.headersSent) {
            const msg = err.message || 'Internal error';
            if (msg.toLowerCase().includes('request too large')) {
                res.status(400).json({ error: msg });
            } else if (err.name === 'TimeoutError' || msg.toLowerCase().includes('timeout')) {
                res.status(504).json({ error: msg });
            } else {
                res.status(500).json({ error: msg });
            }
        }
    }
};

// ============================================================
// INTERNAL HANDLER
// ============================================================

async function handleChatRoute(req, res) {
    const startTime = Date.now();
    const { messages, tools, extra_body, files } = req.body;
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'Client not ready' });

    // --------------------------------------------------------
    // 0. INPUT VALIDATION
    // --------------------------------------------------------
    const msgError = validateMessages(messages);
    if (msgError) return res.status(400).json({ error: msgError });

    const toolsError = validateTools(tools);
    if (toolsError) return res.status(400).json({ error: toolsError });

    const extraError = validateExtraBody(extra_body);
    if (extraError) return res.status(400).json({ error: extraError });

    const apiKey = req.headers.authorization?.replace('Bearer ', '') || 'default';
    global.currentApiKey = apiKey;

    // --------------------------------------------------------
    // 0.1. DEEPSEEK AVAILABILITY
    // --------------------------------------------------------
    try {
        const available = await client.checkDeepSeekAvailable();
        if (!available) {
            return res.status(503).json({
                error: 'DeepSeek is temporarily unavailable. Please try again later.',
                retry_after: 60,
            });
        }
    } catch (err) {
        console.warn('⚠️ Availability check failed, continuing:', err.message);
    }

    // --------------------------------------------------------
    // 1. RAG INITIALIZATION
    // --------------------------------------------------------
    let store = null;
    if (process.env.ENABLE_RAG === 'true') {
        try {
            store = await getHistoryStore(apiKey);
        } catch (err) {
            console.warn('RAG store not available:', err);
        }
    }

    const useSearchRAG = process.env.ENABLE_RAG === 'true' &&
                         client.ragSearchActive === true &&
                         store !== null;

    // --------------------------------------------------------
    // 2. RESOLVE file_id AND PREPARE REQUEST DIRECTORY
    // --------------------------------------------------------
    const fileIds = extractFileIdsFromMessages(messages);
    const textMessages = extractTextFromMessages(messages);
    const tempFilePaths = [];

    // Per-request subdirectory for multipart uploads and RAG context
    // files. Files uploaded via /v1/files are already stored in their
    // own subdirectory (uploads/<fileId>/) and are referenced directly
    // by path — no move, no copy.
    const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const requestDir = path.join(getUploadsDir(), requestId);
    fs.mkdirSync(requestDir, { recursive: true });

    for (const fileId of fileIds) {
        const info = getFileInfo(fileId);
        if (info && fs.existsSync(info.path)) {
            if (!isSafePath(info.path)) {
                console.warn(`⚠️ Unsafe file path for file_id ${fileId}`);
                return res.status(400).json({ error: `Invalid file path for file_id: ${fileId}` });
            }
            tempFilePaths.push(info.path);
            console.log(`📎 Resolved file_id ${fileId} → ${path.basename(info.path)}`);
        } else {
            console.warn(`⚠️ File not found for file_id: ${fileId}`);
            return res.status(400).json({ error: `File not found for file_id: ${fileId}` });
        }
    }

    // --------------------------------------------------------
    // 3. MULTIPART FILES
    // --------------------------------------------------------
    if (files && files.length) {
        for (const file of files) {
            const originalName = decodeOriginalName(file.originalname);
            const ext = path.extname(originalName).toLowerCase();

            if (!isSupportedByDeepSeek(ext)) {
                return res.status(400).json({
                    error: `Unsupported file format: ${ext}. DeepSeek accepts PDF, DOC, XLSX, PPT, images, text, and code.`,
                });
            }
            if (file.size === 0) {
                return res.status(400).json({ error: `File is empty: ${originalName}` });
            }
            if (file.size > MAX_FILE_SIZE) {
                return res.status(400).json({
                    error: `File too large: ${originalName} (${file.size} bytes). Maximum: ${MAX_FILE_SIZE} bytes.`,
                });
            }

            const safeName = sanitizeFilename(originalName);
            const tempPath = uniquePath(requestDir, safeName);
            fs.renameSync(file.path, tempPath);
            tempFilePaths.push(tempPath);
            console.log(`📎 Multipart file: ${originalName} → ${path.basename(tempPath)}`);
        }
    }

    if (tempFilePaths.length > MAX_FILE_COUNT) {
        return res.status(400).json({
            error: `Too many files (${tempFilePaths.length}). Maximum: ${MAX_FILE_COUNT}`,
        });
    }

    // --------------------------------------------------------
    // 4. BUILD PROMPT
    // --------------------------------------------------------
    let userText = '';
    let prompt = '';
    let ragContextPath = null;

    const userMessageObj = textMessages.filter(m => m.role === 'user').pop();
    if (userMessageObj) {
        userText = userMessageObj.content || '';
    }

    if (!userText && tempFilePaths.length > 0) {
        userText = 'Please analyze the uploaded file(s).';
    }

    // Working copy of the messages array. RAG may prepend a System-level
    // instruction (see below), and the prompt is rebuilt afterwards so
    // that buildPrompt() can apply its role prefixes to the full set.
    const fullMessages = textMessages.length > 0 ? textMessages : messages || [];
    prompt = buildPrompt(fullMessages, tools);

    // RAG retrieval: results are written to a temporary file that is
    // attached to the current message, and a System-level instruction is
    // prepended so the model treats the file as an authoritative source.
    if (useSearchRAG && userText) {
        try {
            const results = await store.search(userText, client.currentChatId, 5);

            console.log(`📚 RAG search returned ${results.length} result(s)`);
            for (const r of results) {
                const sim = r.similarity.toFixed(3);
                const score = r.score.toFixed(3);
                const pos = r.storeIndex;
                if (r.item.type === 'exchange') {
                    const preview = (r.item.user || '').substring(0, 60).replace(/\s+/g, ' ');
                    console.log(`   [score=${score}, sim=${sim}, idx=${pos}] exchange: "${preview}..."`);
                } else if (r.item.type === 'file') {
                    console.log(`   [score=${score}, sim=${sim}, idx=${pos}] file: ${r.item.fileName} chunk ${r.item.chunkIndex}`);
                }
            }

            if (results.length > 0) {
                const exchangeMap = new Map();
                for (const r of results) {
                    if (r.item.type === 'exchange') {
                        const key = `${r.item.user}||${r.item.assistant}`;
                        if (!exchangeMap.has(key)) exchangeMap.set(key, []);
                        exchangeMap.get(key).push(r.item);
                    }
                }

                const fragmentBlocks = [];
                for (const chunks of exchangeMap.values()) {
                    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
                    const fullCombined = chunks.map(c => c.combined).join('');
                    fragmentBlocks.push(`--- Fragment (from earlier exchange) ---\n${fullCombined}`);
                }
                for (const r of results) {
                    if (r.item.type === 'file') {
                        fragmentBlocks.push(
                            `--- Fragment (from file: ${r.item.fileName}) ---\n${r.item.content}`
                        );
                    }
                }

                if (fragmentBlocks.length > 0) {
                    const ragHeader =
                        '[RAG context — retrieved from indexed history]\n\n' +
                        'The following fragments were automatically retrieved from ' +
                        "the user's indexed history. They are provided as background " +
                        'material for the current question. Treat them as a reference ' +
                        'document.\n\n';
                    const ragFooter = '\n\n[End of retrieved context]\n';

                    ragContextPath = path.join(
                        requestDir,
                        `rag_context_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.txt`
                    );
                    fs.writeFileSync(
                        ragContextPath,
                        ragHeader + fragmentBlocks.join('\n\n') + ragFooter,
                        'utf-8'
                    );
                    tempFilePaths.push(ragContextPath);

                    // Prepend a System-level instruction so the model registers
                    // the attached file as a trusted source. The instruction is
                    // short, so it will not be converted into a file by the
                    // DeepSeek UI. Rebuild the prompt with this message included
                    // so buildPrompt() adds the System: role prefix.
                    const uploadInstruction = loadPrompt('rag_upload_prompt.txt', {
                        required: true,
                    });
                    fullMessages.unshift({ role: 'system', content: uploadInstruction });
                    prompt = buildPrompt(fullMessages, tools);

                    const fileCount = results.filter(r => r.item.type === 'file').length;
                    console.log(
                        `📚 RAG context written to file: ${path.basename(ragContextPath)} ` +
                        `(${fragmentBlocks.length} fragment(s): ${exchangeMap.size} exchange(s), ${fileCount} file chunk(s))`
                    );
                    console.log(`📚 RAG instruction injected as System message`);
                }
            }
        } catch (err) {
            console.error('RAG search failed:', err);
        }
    }

    console.log(`📤 Question: ${userText?.substring(0, 100) || 'No text'}...`);
    if (tools?.length) console.log(`🔧 Tools: ${tools.map(t => t.function.name).join(', ')}`);
    if (tempFilePaths.length) console.log(`📎 Files included: ${tempFilePaths.map(p => path.basename(p)).join(', ')}`);

    // --------------------------------------------------------
    // 5. TASKS
    // --------------------------------------------------------
    const tasksToAdd = [];

    if (extra_body?.deepthink !== undefined) {
        tasksToAdd.push(new SwitchDeepThinkTask(extra_body.deepthink));
    } else {
        tasksToAdd.push(new SwitchDeepThinkTask(false));
    }

    if (extra_body?.web_search !== undefined) {
        tasksToAdd.push(new SwitchWebSearchTask(extra_body.web_search));
    } else {
        tasksToAdd.push(new SwitchWebSearchTask(false));
    }

    global.currentTools = tools;
    global.currentMessages = messages;

    const userTask = new SendUserMessageTask(prompt, tempFilePaths, userText);
    tasksToAdd.push(userTask);

    // --------------------------------------------------------
    // 6. EXECUTE
    // --------------------------------------------------------
    let result;
    for (let i = 0; i < tasksToAdd.length; i++) {
        const task = tasksToAdd[i];
        if (i === tasksToAdd.length - 1) {
            result = await client.taskQueue.add(task);
        } else {
            await client.taskQueue.add(task);
        }
    }

    global.currentTools = null;
    global.currentMessages = null;

    // --------------------------------------------------------
    // 7. RAG SAVE (exchange)
    // --------------------------------------------------------
    if (store && userMessageObj && result && useSearchRAG) {
        await store.addExchange(client.currentChatId, userMessageObj.content, result);
        console.log('💾 Exchange saved to RAG store');
    }

    // --------------------------------------------------------
    // 8. ENQUEUE FILES FOR BACKGROUND INDEXING
    // --------------------------------------------------------
    // File indexing is CPU-bound (embedding) and can take minutes for
    // large files. Running it inside the request would hold the client
    // for the entire duration and risk hitting undici's 5-minute
    // timeout. Enqueue the files and let the background worker do the
    // work while the response is already on its way back.
    //
    // Ownership: after enqueue, the queue deletes the file when it is
    // done with it. chat.js must not delete enqueued files itself.
    const enqueuedPaths = new Set();
    if (process.env.ENABLE_RAG === 'true' &&
        tempFilePaths.length > 0 &&
        client.currentChatId) {
        try {
            const queue = getIndexingQueue();
            for (const p of tempFilePaths) {
                queue.enqueue({
                    filePath: p,
                    apiKey,
                    chatId: client.currentChatId,
                    fileName: path.basename(p),
                });
                enqueuedPaths.add(p);
            }
        } catch (err) {
            console.error('Failed to enqueue files for indexing:', err);
        }
    }

    // --------------------------------------------------------
    // 9. CLEANUP (only files that were NOT enqueued)
    // --------------------------------------------------------
    for (const p of tempFilePaths) {
        if (enqueuedPaths.has(p)) continue;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // Remove empty per-request directories. Enqueued files are still
    // on disk; the indexing worker removes their directories after
    // processing.
    const uploadsRoot = path.resolve(getUploadsDir());
    const dirsToClean = new Set([path.resolve(requestDir)]);
    for (const p of tempFilePaths) {
        const parent = path.resolve(path.dirname(p));
        if (parent !== uploadsRoot) dirsToClean.add(parent);
    }
    for (const dir of dirsToClean) {
        try { fs.rmdirSync(dir); } catch { /* not empty */ }
    }

    // --------------------------------------------------------
    // 10. RESPONSE
    // --------------------------------------------------------
    //
    // DeepSeek Web is a text interface: the model has no native
    // tool-calling channel. It may wrap its tool_calls JSON in
    // markdown fences, add conversational preamble, or drop the
    // closing brackets on long compact output. parseResponse handles
    // all three cases. See algorithms B8 and B9 in
    // docs/algorithms/response.md.
    //
    const { isToolCall, parsed: parsedResponse, wasTruncated } = parseResponse(result);

    if (wasTruncated) {
        console.log('🔧 Repaired truncated tool_calls JSON (brackets appended)');
    }

    if (!isToolCall && result.includes('"tool_calls"')) {
        console.warn(
            `⚠️ tool_calls marker present but not parsed. ` +
            `preview: ${result.substring(0, 200)}`
        );
    }

    let openaiResponse;
    if (isToolCall) {
        const toolCalls = parsedResponse.tool_calls.map(normalizeToolCall);
        openaiResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'deepseek-chat',
            choices: [{
                index: 0,
                message: { role: 'assistant', content: null, tool_calls: toolCalls },
                finish_reason: wasTruncated ? 'length' : 'tool_calls',
            }],
            usage: {
                prompt_tokens: Math.ceil(prompt.length / 4),
                completion_tokens: Math.ceil(result.length / 4),
                total_tokens: Math.ceil((prompt.length + result.length) / 4),
            },
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
                finish_reason: 'stop',
            }],
            usage: {
                prompt_tokens: Math.ceil(prompt.length / 4),
                completion_tokens: Math.ceil(result.length / 4),
                total_tokens: Math.ceil((prompt.length + result.length) / 4),
            },
        };
    }

    openaiResponse.context_status = client.contextManager.getContextStatus(client.lastLengthLimit);

    console.log(`✅ Response sent in ${Date.now() - startTime}ms`);
    res.json(openaiResponse);
}