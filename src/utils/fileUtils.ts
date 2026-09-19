// src/utils/fileUtils.ts
/**
 * @file src/utils/fileUtils.ts
 * File-handling utilities: extension classification, safe reading,
 * and decisions about whether a file can be indexed by RAG.
 *
 * Three extension sets are defined:
 *   - UTF8_TEXT_EXTENSIONS       — read as plain text, indexable
 *   - PARSABLE_EXTENSIONS        — binary/office formats, not indexed
 *   - BINARY_EXTENSIONS          — images, archives, media, not indexed
 *
 * The union of UTF8_TEXT_EXTENSIONS and PARSABLE_EXTENSIONS plus the
 * image subset of BINARY_EXTENSIONS forms the accepted-upload set for
 * the DeepSeek UI.
 */

import fs from 'fs';
import path from 'path';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Tokens per image in DeepSeek V4.1 Flash.
 *
 * Images are downsampled by the vision encoder and capped at 384 tokens,
 * independent of source resolution.
 */
export const IMAGE_TOKENS = 384;

// ============================================================
// EXTENSION LISTS
// ============================================================

/**
 * Files that can be safely read as UTF-8 text and indexed for RAG.
 */
export const UTF8_TEXT_EXTENSIONS = new Set<string>([
    // Source code
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.go', '.rs', '.rb', '.php', '.pl', '.pm', '.lua', '.r', '.swift', '.kt',
    '.scala', '.clj', '.hs', '.erl', '.ex', '.exs', '.fs', '.fsx', '.vb', '.vbs',
    '.ps1', '.sh', '.bash', '.zsh', '.fish', '.cmd', '.bat',
    // Config & markup
    '.json', '.yml', '.yaml', '.toml', '.ini', '.conf', '.cfg', '.properties',
    '.env', '.gitignore', '.gitmodules', '.html', '.htm', '.xml', '.xhtml', '.svg',
    '.css', '.scss', '.less', '.sass', '.styl', '.vue', '.svelte',
    '.ejs', '.pug', '.haml', '.slim', '.erb', '.jade',
    // Docs & logs
    '.txt', '.md', '.rst', '.rest', '.adoc', '.asciidoc', '.tex', '.bib',
    '.csv', '.tsv', '.log', '.sql'
]);

/**
 * Office documents that require parsing (not indexed as text).
 * Kept separately so that isIndexableFile() can exclude them explicitly.
 */
export const PARSABLE_EXTENSIONS = new Set<string>([
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.odt', '.ods', '.odp', '.rtf'
]);

/**
 * Binary formats that never make sense as text: images, archives,
 * executables, media, and databases.
 */
export const BINARY_EXTENSIONS = new Set<string>([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tif', '.tiff',
    '.avif', '.apng', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.o', '.obj',
    '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
    '.psd', '.ai', '.eps', '.indd', '.bin', '.dat', '.db', '.sqlite'
]);

/**
 * Extensions accepted by the DeepSeek UI for upload.
 *
 * Sourced from the `accept` attribute of the file input on
 * chat.deepseek.com. Anything outside this set is rejected by the
 * upload endpoint before reaching the browser.
 */
export const DEEPSEEK_SUPPORTED_EXTENSIONS = new Set<string>([
    // Documents
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.odt', '.ods', '.odp', '.rtf',
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
    '.tif', '.tiff', '.avif', '.apng', '.svg', '.svgz',
    // Text
    '.txt', '.md', '.csv', '.tsv', '.log',
    // Code
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.go', '.rs', '.rb', '.php', '.pl', '.pm', '.lua', '.r', '.swift', '.kt',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
    // Config & markup
    '.json', '.yml', '.yaml', '.toml', '.ini', '.conf', '.cfg',
    '.html', '.htm', '.xml', '.css', '.scss', '.less',
]);

// ============================================================
// FILE CHECK FUNCTIONS
// ============================================================

/**
 * Decide whether a file's content can be indexed by RAG.
 *
 * Only plain-text formats are indexed. Office documents are not parsed
 * in this project, and binary/media formats are not text at all.
 * The extension-based classification is confirmed by a quick null-byte
 * check to filter out misnamed binaries.
 *
 * @param filePath - Path to the file.
 * @returns true if the file can be read as UTF-8 text and indexed.
 */
export function isIndexableFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();

    if (UTF8_TEXT_EXTENSIONS.has(ext)) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (content.includes('\0')) return false;
            return true;
        } catch {
            return false;
        }
    }

    if (PARSABLE_EXTENSIONS.has(ext)) return false;
    if (BINARY_EXTENSIONS.has(ext)) return false;
    return false;
}

/**
 * Check whether the file has an image extension.
 * Used to select token-cost estimation and to skip text indexing.
 *
 * @param filePath - Path to the file.
 * @returns true if the extension matches a known image format.
 */
export function isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const imageExtensions = new Set<string>([
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
        '.tif', '.tiff', '.avif', '.apng', '.svg', '.svgz'
    ]);
    return imageExtensions.has(ext);
}

/**
 * Check whether the file is likely plain text (by extension only,
 * without reading it).
 *
 * @param filePath - Path to the file.
 * @returns true if the extension is in UTF8_TEXT_EXTENSIONS.
 */
export function isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return UTF8_TEXT_EXTENSIONS.has(ext);
}

/**
 * Read a file as UTF-8 text, returning null if it contains a null byte
 * (binary content) or cannot be read.
 *
 * @param filePath - Path to the file.
 * @returns File content, or null on failure or binary content.
 */
export function readTextFileSafe(filePath: string): string | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.includes('\0')) return null;
        return content;
    } catch {
        return null;
    }
}

/**
 * Classify a file into one of five categories based on its extension.
 * Used by size estimation and diagnostics.
 *
 * @param filePath - Path to the file.
 * @returns 'text' | 'image' | 'office' | 'binary' | 'unknown'.
 */
export function getFileCategory(filePath: string): 'text' | 'image' | 'office' | 'binary' | 'unknown' {
    const ext = path.extname(filePath).toLowerCase();
    if (UTF8_TEXT_EXTENSIONS.has(ext)) return 'text';
    if (PARSABLE_EXTENSIONS.has(ext)) return 'office';
    if (BINARY_EXTENSIONS.has(ext)) return 'binary';
    if (isImageFile(filePath)) return 'image';
    return 'unknown';
}

/**
 * Check whether DeepSeek's UI accepts the given extension for upload.
 *
 * @param ext - Extension with a leading dot, e.g. ".pdf".
 * @returns true if the extension is in DEEPSEEK_SUPPORTED_EXTENSIONS.
 */
export function isSupportedByDeepSeek(ext: string): boolean {
    return DEEPSEEK_SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}