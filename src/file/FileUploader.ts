// src/file/FileUploader.ts
/**
 * @file src/file/FileUploader.ts
 * Handles file uploads to the DeepSeek UI.
 * Supports single and multiple file uploads.
 *
 * Context size is updated after a successful upload but no pre-flight size
 * check is performed. The server reacts to actual rejections from DeepSeek
 * (409 on length-limit banner) rather than predicting them in advance.
 */

import fs from 'fs';
import path from 'path';
import { ChatController } from '../chat/ChatController.js';
import { ContextManager } from '../context/ContextManager.js';
import { isImageFile, IMAGE_TOKENS } from '../utils/fileUtils.js';

/**
 * FileUploader attaches files to the chat via UI automation and keeps the
 * context-size counter in sync with what has actually been attached.
 */
export class FileUploader {
    constructor(
        private chatController: ChatController,
        private contextManager: ContextManager
    ) {}

    /**
     * Estimate the size of a file in characters.
     * - Images: IMAGE_TOKENS * languageCoefficient (independent of file bytes).
     * - Text files: UTF-8 character count.
     * - Fallback: raw byte size when the file cannot be read as UTF-8.
     *
     * @param filePath - Path to the file.
     * @returns Estimated size in characters.
     */
    public getFileSizeInChars(filePath: string): number {
        if (isImageFile(filePath)) {
            const coef = this.contextManager.getLanguageCoefficient();
            return Math.floor(IMAGE_TOKENS * coef);
        }
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content.length;
        } catch {
            const stats = fs.statSync(filePath);
            return stats.size;
        }
    }

    /**
     * Upload one or more files to the chat UI.
     *
     * Files are attached first; the context-size counter is updated only
     * after a successful attachment, and only when skipStats is false.
     * Snapshot uploads pass skipStats = true because they are service data
     * that should not count against the user's context budget.
     *
     * @param filePath - Single file path or array of file paths.
     * @param skipStats - When true, do not add the file size to the counter.
     */
    async upload(filePath: string | string[], skipStats: boolean = false): Promise<void> {
        const files = Array.isArray(filePath) ? filePath : [filePath];

        await this.chatController.attachFile(files);

        if (!skipStats) {
            let totalSize = 0;
            for (const file of files) {
                totalSize += this.getFileSizeInChars(file);
            }
            if (totalSize > 0) {
                await this.contextManager.addChars(totalSize);
            }
        }

        console.log(`📎 File(s) attached: ${files.map(p => path.basename(p)).join(', ')}`);
    }
}