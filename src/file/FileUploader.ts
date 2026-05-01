// src/file/FileUploader.ts
import fs from 'fs';
import { ChatController } from '../chat/ChatController.js';
import { ContextManager } from '../context/ContextManager.js';

export class NeedTransitionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NeedTransitionError';
    }
}

export class FileUploader {
    constructor(
        private chatController: ChatController,
        private contextManager: ContextManager
    ) {}

    private getFileSizeInChars(filePath: string): number {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content.length;
        } catch (err) {
            const stats = fs.statSync(filePath);
            console.warn(`File not UTF-8, using byte size as char estimate: ${stats.size} bytes`);
            return stats.size;
        }
    }

    async upload(filePath: string): Promise<void> {
        const fileSizeChars = this.getFileSizeInChars(filePath);
        const can = await this.contextManager.canUploadFile(fileSizeChars);
        if (!can) {
            throw new NeedTransitionError(`File too large for current context, need transition`);
        }
        console.log(`📎 File size: ${fileSizeChars} chars`);
        const statsBefore = await this.contextManager.getStats();
        console.log(`📊 [BEFORE FILE UPLOAD] Context: ${statsBefore.totalChars} / ${statsBefore.maxChars} chars (${statsBefore.percent}%)`);
        await this.chatController.attachFile(filePath);
        await this.contextManager.updateStats(fileSizeChars);
        const statsAfter = await this.contextManager.getStats();
        console.log(`📊 [AFTER FILE UPLOAD] Context: ${statsAfter.totalChars} / ${statsAfter.maxChars} chars (${statsAfter.percent}%)`);
        console.log(`📎 File uploaded: ${filePath}`);
    }
}