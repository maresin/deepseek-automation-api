// src/tasks/SendUserMessageTask.ts
import path from 'path';
import fs from 'fs';
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';
import { NeedTransitionError } from '../file/FileUploader.js';

export class SendUserMessageTask extends Task<string> {
    constructor(
        private text: string,
        private filePath?: string
    ) {
        const desc = filePath ? `Send message with file ${filePath}` : `Send message: ${text.substring(0, 50)}`;
        super(desc, 'normal');
        this.maxRetries = 1; // один повтор в случае перехода
    }

    async execute(client: DeepSeekClient): Promise<string> {
        // Системный промпт, если ещё не отправлен
        if (!client.isSystemPromptSent() && client.getSystemPromptText()) {
            console.log('📌 Sending system prompt before user message...');
            const systemPromptText = client.getSystemPromptText()!;
            await client.executePipeline({ text: systemPromptText });
            client.setSystemPromptSent(true);
            console.log('✅ System prompt sent and confirmed');
        }

        try {
            const response = await client.executePipeline({
                text: this.text,
                filePath: this.filePath
            });
            client.setChatStarted(true);
            return response;
        } catch (err) {
            if (err instanceof NeedTransitionError) {
                console.log('🔄 File upload requires transition – performing sync transition and retry...');
                await this.performTransition(client);
                // После перехода повторяем отправку (рекурсивный вызов)
                return await this.execute(client);
            }
            throw err;
        }
    }

    private async performTransition(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Starting transition to new chat due to large file...');

        // 1. Создаём снимок (если есть промпт)
        const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
        let snapshot = '';
        if (fs.existsSync(snapshotPromptPath)) {
            const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
            console.log('📸 Creating context snapshot...');
            const wasDeepThink = await client.featureToggles.isDeepThinkEnabled();
            if (!wasDeepThink) await client.featureToggles.setDeepThink(true);
            snapshot = await client.executePipeline({ text: snapshotPrompt });
            if (!wasDeepThink) await client.featureToggles.setDeepThink(false);
            if (snapshot && snapshot.length > 0) {
                const currentPercent = Math.round(client.contextManager['totalChars'] / client.contextManager['maxChars'] * 100);
                client.contextManager['saveSnapshot'](snapshot, currentPercent);
                console.log(`💾 Snapshot saved (${snapshot.length} chars)`);
            }
        } else {
            console.warn('⚠️ Snapshot prompt not found, skipping snapshot creation');
        }

        // 2. Создаём новый чат вручную (без очистки папки uploads)
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext(); // сбрасываем счётчик, но не удаляем snapshot-файлы

        // 3. Восстанавливаем снимок (если есть)
        const savedSnapshot = await client.contextManager.getSnapshot();
        if (savedSnapshot && savedSnapshot.length > 0) {
            console.log(`📤 Restoring snapshot (${savedSnapshot.length} chars) in new chat...`);
            await client.executePipeline({ text: savedSnapshot });
            await client.contextManager.resetContext(savedSnapshot);
        } else {
            console.warn('⚠️ No snapshot to restore');
        }

        console.log('✅ Sync transition completed, retrying original request');
    }
}