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
        const stats = await this.contextManager.getStats();
        const wouldBePercent = ((stats.totalChars + fileSizeChars) / stats.maxChars) * 100;
        
        if (wouldBePercent > 90) {
            if (wouldBePercent <= 95 && this.contextManager.canCreateTransitionSnapshot(fileSizeChars)) {
                await this.contextManager.createTransitionSnapshot();
            }
            throw new NeedTransitionError(`File would exceed context limit (${wouldBePercent.toFixed(1)}%). Need transition.`);
        }
        
        console.log(`📎 File size: ${fileSizeChars} chars`);
        console.log(`📊 [BEFORE] Context: ${stats.totalChars} / ${stats.maxChars} chars (${stats.percent}%)`);
        await this.chatController.attachFile(filePath);
        const afterStats = await this.contextManager.getStats();
        console.log(`📊 [AFTER] Context: ${afterStats.totalChars} / ${afterStats.maxChars} chars (${afterStats.percent}%)`);
        console.log(`📎 File attached: ${filePath}`);
    }
}