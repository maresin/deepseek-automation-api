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
        // Удаляем все временные файлы в папке uploads
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const file of files) {
                const filePath = path.join(uploadsDir, file);
                try {
                    fs.unlinkSync(filePath);
                } catch (e) { console.warn(`Failed to delete ${filePath}:`, e); }
            }
            console.log(`🧹 Cleaned uploads folder (${files.length} files)`);
        }

        // Полная очистка контекстных данных (счётчик, снимки)
        await client.contextManager.clearAllContextData();

        // Создаём новый чат в браузере
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
    }
}