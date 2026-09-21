// server-modules/routes/single.js
/**
 * @file server-modules/routes/single.js
 * Route handler for POST /v1/chat/single.
 *
 * Runs the request in a temporary chat so that the main session's context
 * is not touched. Two optional flags control the side effects:
 *
 *   insert_to_context : if true, the answer is appended to the main chat
 *                       as a System-labelled message.
 *   return_only       : if true, only the answer is returned; no wrapper
 *                       metadata is included.
 *
 * Typical use case: describing an image in isolation and inserting the
 * description into the main session as reference material.
 */

const path = require('path');
const fs = require('fs');
const { getClient } = require('../state');
const { getUploadsDir } = require('../../dist/utils/paths.js');

module.exports = async function singleRoute(req, res) {
    const client = getClient();
    if (!client) {
        return res.status(503).json({ error: 'Client not ready' });
    }

    const { insert_to_context, return_only } = req.body;

    // `messages` may arrive as a JSON string when sent via multipart.
    let messages = req.body.messages;
    if (typeof messages === 'string') {
        try {
            messages = JSON.parse(messages);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid JSON in messages' });
        }
    }
    if (!Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages must be an array' });
    }

    const userMessage = messages.filter(m => m.role === 'user').pop();
    const file = req.file;
    if (!userMessage && !file) {
        return res.status(400).json({ error: 'No user message or file' });
    }

    // Move the uploaded file to its final location under uploads/.
    let tempFilePath = null;
    if (file) {
        const ext = path.extname(file.originalname);
        tempFilePath = path.join(getUploadsDir(), `${Date.now()}${ext}`);
        fs.renameSync(file.path, tempFilePath);
    }

    // Run the request in a temporary chat. The client restores the
    // original chat automatically when it is done.
    let response;
    try {
        response = await client.executeInTemporaryChat(messages, tempFilePath);
    } catch (err) {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
        console.error('Single request failed:', err);
        return res.status(500).json({ error: err.message });
    }
    if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
    }

    // Optionally append the answer to the main chat as a system message.
    const insert = insert_to_context === 'true' || insert_to_context === true;
    if (insert) {
        try {
            await client.executePipeline({
                text: `[System] Context from previous analysis:\n` +
                      `Question: ${userMessage?.content || 'Image analysis'}\n` +
                      `Answer: ${response}`,
                skipStatsUpdate: true,
            });
            console.log('📥 Inserted response into main chat history');
        } catch (err) {
            console.error('Failed to insert context:', err);
        }
    }

    if (return_only === 'true' || return_only === true) {
        return res.json({ answer: response });
    }

    res.json({
        success: true,
        answer: response,
        inserted: insert,
    });
};