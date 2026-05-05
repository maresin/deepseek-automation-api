// src/tasks/NewChatTask.ts
import fs from 'fs';
import path from 'path';
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class NewChatTask extends Task<void> {
    constructor() {
        super('Create new chat', 'normal');
    }

    async execute(client: DeepSeekClient): Promise<void> {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const file of files) {
                try {
                    fs.unlinkSync(path.join(uploadsDir, file));
                } catch (e) {}
            }
            console.log(`🧹 Cleaned uploads folder (${files.length} files)`);
        }
        await client.contextManager.clearAllContextData();

        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
    }
}