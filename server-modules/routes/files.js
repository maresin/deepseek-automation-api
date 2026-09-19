// server-modules/routes/files.js
/**
 * @file server-modules/routes/files.js
 * OpenAI-compatible file upload endpoint.
 *
 * POST /v1/files accepts a multipart/form-data request with a single
 * "file" field and returns an OpenAI-compatible file object containing
 * a file_id. The file_id can later be referenced in /v1/chat/completions
 * as part of a message's content array.
 */

const path = require('path');
const fs = require('fs');
const { isSupportedByDeepSeek } = require('../../dist/utils/fileUtils.js');

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// File-id → absolute path map. Shared with chat.js via getFilePath().
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
 * Resolve a previously uploaded file_id back to its filesystem path.
 * @param {string} fileId - Identifier returned by uploadFile().
 * @returns {string|null} Absolute path, or null if the id is unknown.
 */
function getFilePath(fileId) {
    if (!global.fileMap) {
        global.fileMap = new Map();
    }
    return global.fileMap.get(fileId) || null;
}

/**
 * POST /v1/files — OpenAI-compatible file upload.
 *
 * Validates the file extension, size, and non-emptiness, moves the file
 * into the uploads/ directory, stores the mapping, and returns an OpenAI
 * file object.
 */
async function uploadFile(req, res) {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(file.originalname).toLowerCase();

    if (!isSupportedByDeepSeek(ext)) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({
            error: `Unsupported file format: ${ext}. DeepSeek accepts PDF, DOC, XLSX, PPT, images, text, and code.`
        });
    }

    if (file.size === 0) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({ error: `File is empty: ${file.originalname}` });
    }

    if (file.size > MAX_FILE_SIZE) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({
            error: `File too large: ${file.originalname} (${file.size} bytes). Maximum: ${MAX_FILE_SIZE} bytes.`
        });
    }

    const fileId = generateFileId();
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const fileNameWithExt = fileId + ext;
    const filePath = path.join(uploadDir, fileNameWithExt);
    fs.renameSync(file.path, filePath);

    if (!global.fileMap) {
        global.fileMap = new Map();
    }
    global.fileMap.set(fileId, filePath);

    console.log(`📎 File uploaded: ${file.originalname} → ${fileNameWithExt} (${file.size} bytes)`);

    res.json({
        id: fileId,
        object: 'file',
        bytes: file.size,
        created_at: Math.floor(Date.now() / 1000),
        filename: file.originalname,
        purpose: req.body.purpose || 'assistants'
    });
}

module.exports = {
    uploadFile,
    getFilePath
};