// server-modules/routes/files.js
/**
 * @file server-modules/routes/files.js
 * OpenAI-compatible file upload endpoint.
 *
 * POST /v1/files accepts a multipart/form-data request with a single
 * "file" field and returns an OpenAI-compatible file object containing
 * a file_id. The file_id can later be referenced in /v1/chat/completions
 * as part of a message's content array.
 *
 * Each upload is stored in its own subdirectory:
 *
 *     uploads/<fileId>/<originalName>
 *
 * The subdirectory isolates the file from other uploads and keeps the
 * original basename intact — Playwright uses basename when attaching
 * the file to the DeepSeek UI, so the model sees the name the client
 * sent, not a random temp identifier.
 */

const path = require('path');
const fs = require('fs');
const { isSupportedByDeepSeek } = require('../../dist/utils/fileUtils.js');
const { getUploadsDir } = require('../../dist/utils/paths.js');
const {
    sanitizeFilename,
    uniquePath,
    decodeOriginalName,
} = require('../utils.js');

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// File-id → record map. Shared with chat.js via getFileInfo().
// Record shape: { path, originalName, mimeType }.
if (!global.fileMap) {
    global.fileMap = new Map();
}

/**
 * Generate a unique file_id.
 * @returns {string} Opaque identifier in the form file_<timestamp>_<random>.
 */
function generateFileId() {
    return `file_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Return the filesystem path for a file_id, or null if unknown.
 *
 * @param {string} fileId
 * @returns {string|null}
 */
function getFilePath(fileId) {
    const info = global.fileMap ? global.fileMap.get(fileId) : null;
    return info ? info.path : null;
}

/**
 * Return the full record for a file_id:
 *   { path, originalName, mimeType }
 * or null if the id is unknown.
 *
 * @param {string} fileId
 * @returns {{ path: string, originalName: string, mimeType: string } | null}
 */
function getFileInfo(fileId) {
    if (!global.fileMap) {
        global.fileMap = new Map();
    }
    return global.fileMap.get(fileId) || null;
}

/**
 * POST /v1/files — OpenAI-compatible file upload.
 *
 * Validates the file extension, size, and non-emptiness, moves the file
 * into uploads/<fileId>/<originalName>, stores the mapping, and returns
 * an OpenAI file object.
 */
async function uploadFile(req, res) {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Multer decodes the multipart filename header as latin1. For UTF-8
    // filenames (Cyrillic, CJK, accented Latin) this produces mojibake.
    // decodeOriginalName reinterprets the bytes as UTF-8 when the
    // round-trip is lossless.
    const originalName = decodeOriginalName(file.originalname);
    const ext = path.extname(originalName).toLowerCase();

    if (!isSupportedByDeepSeek(ext)) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({
            error: `Unsupported file format: ${ext}. DeepSeek accepts PDF, DOC, XLSX, PPT, images, text, and code.`
        });
    }

    if (file.size === 0) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({ error: `File is empty: ${originalName}` });
    }

    if (file.size > MAX_FILE_SIZE) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({
            error: `File too large: ${originalName} (${file.size} bytes). Maximum: ${MAX_FILE_SIZE} bytes.`
        });
    }

    const fileId = generateFileId();
    const dir = path.join(getUploadsDir(), fileId);
    fs.mkdirSync(dir, { recursive: true });

    const safeName = sanitizeFilename(originalName);
    const filePath = uniquePath(dir, safeName);
    fs.renameSync(file.path, filePath);

    if (!global.fileMap) {
        global.fileMap = new Map();
    }
    global.fileMap.set(fileId, {
        path: filePath,
        originalName,
        mimeType: file.mimetype,
    });

    console.log(`📎 File uploaded: ${originalName} → ${fileId}/${path.basename(filePath)} (${file.size} bytes)`);

    res.json({
        id: fileId,
        object: 'file',
        bytes: file.size,
        created_at: Math.floor(Date.now() / 1000),
        filename: originalName,
        purpose: req.body.purpose || 'assistants'
    });
}

module.exports = {
    uploadFile,
    getFilePath,
    getFileInfo,
};