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
        this.maxRetries = 1;
    }

    async execute(client: DeepSeekClient): Promise<string> {
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
                return await this.execute(client);
            }
            throw err;
        }
    }

    private async performTransition(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Starting transition to new chat due to large file...');

        // 1. Создаём снимок (текст)
        const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
        if (!fs.existsSync(snapshotPromptPath)) {
            throw new Error('Snapshot prompt file not found, cannot perform transition');
        }
        const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
        console.log('📸 Creating context snapshot...');
        const wasDeepThink = await client.featureToggles.isDeepThinkEnabled();
        if (!wasDeepThink) await client.featureToggles.setDeepThink(true);
        const snapshotContent = await client.executePipeline({ text: snapshotPrompt });
        if (!wasDeepThink) await client.featureToggles.setDeepThink(false);
        if (!snapshotContent || snapshotContent.trim().length === 0) {
            throw new Error('Failed to create snapshot: empty response');
        }
        // Сохраняем снимок в файл
        const snapshotFileName = `snapshot_${Date.now()}.txt`;
        const snapshotFilePath = path.join(process.cwd(), 'uploads', snapshotFileName);
        fs.writeFileSync(snapshotFilePath, snapshotContent, 'utf-8');
        console.log(`💾 Snapshot saved to file: ${snapshotFilePath} (${snapshotContent.length} chars)`);

        // 2. Создаём новый чат вручную (без очистки uploads)
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        // 3. Читаем промпт для загрузки снимка
        const uploadPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_upload_prompt.txt');
        let uploadPrompt = "Here is the context snapshot of our previous session (attached file). Please accept it and confirm by replying 'OK'.";
        if (fs.existsSync(uploadPromptPath)) {
            uploadPrompt = fs.readFileSync(uploadPromptPath, 'utf-8');
        } else {
            console.warn(`⚠️ Snapshot upload prompt not found at ${uploadPromptPath}, using default.`);
        }
        console.log('📤 Uploading snapshot file with prompt...');
        await client.executePipeline({ text: uploadPrompt, filePath: snapshotFilePath });

        // 4. Удаляем временный файл снимка
        try {
            fs.unlinkSync(snapshotFilePath);
            console.log(`🧹 Deleted snapshot file: ${snapshotFilePath}`);
        } catch (e) {
            console.warn(`Failed to delete snapshot file: ${snapshotFilePath}`);
        }

        console.log('✅ Sync transition completed, retrying original request');
    }
}