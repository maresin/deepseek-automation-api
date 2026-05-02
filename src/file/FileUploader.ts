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
        } catch {
            const stats = fs.statSync(filePath);
            return stats.size;
        }
    }

    async upload(filePath: string): Promise<void> {
        const fileSizeChars = this.getFileSizeInChars(filePath);
        const can = await this.contextManager.canUploadFile(fileSizeChars);
        if (!can) {
            throw new NeedTransitionError(`File too large for current context, need transition (${fileSizeChars} chars required)`);
        }
        console.log(`📎 File size: ${fileSizeChars} chars`);
        const statsBefore = await this.contextManager.getStats();
        console.log(`📊 [BEFORE] Context: ${statsBefore.totalChars} / ${statsBefore.maxChars} chars (${statsBefore.percent}%)`);
        await this.chatController.attachFile(filePath);
        // НЕ обновляем статистику здесь – это делает executePipeline
        const statsAfter = await this.contextManager.getStats();
        console.log(`📊 [AFTER] Context: ${statsAfter.totalChars} / ${statsAfter.maxChars} chars (${statsAfter.percent}%)`);
        console.log(`📎 File attached: ${filePath}`);
    }
}