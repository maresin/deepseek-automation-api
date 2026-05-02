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
        this.maxRetries = 0;
    }

    private getFileSizeInChars(filePath: string): number {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content.length;
        } catch {
            const stats = fs.statSync(filePath);
            return stats.size;
        }
    }

    async execute(client: DeepSeekClient): Promise<string> {
        if (client.needTransition) {
            console.log('🚦 Performing pending transition due to high context usage');
            await this.performTransition(client);
            client.needTransition = false;
        }

        if (!client.isSystemPromptSent() && client.getSystemPromptText()) {
            console.log('📌 Sending system prompt before user message...');
            const systemPromptText = client.getSystemPromptText()!;
            await client.executePipeline({ text: systemPromptText, skipStatsUpdate: false });
            client.setSystemPromptSent(true);
            console.log('✅ System prompt sent and confirmed');
        }

        try {
            let requiredChars = this.text.length;
            if (this.filePath) {
                requiredChars += this.getFileSizeInChars(this.filePath);
            }
            const canFit = await client.contextManager.canUploadFile(requiredChars);
            if (!canFit) {
                throw new NeedTransitionError(`Not enough context space for this message (need ${requiredChars} chars)`);
            }
            const response = await client.executePipeline({
                text: this.text,
                filePath: this.filePath,
                skipStatsUpdate: false
            });
            client.setChatStarted(true);
            return response;
        } catch (err) {
            if (err instanceof NeedTransitionError) {
                console.log('🔄 NeedTransitionError caught, performing transition and retry...');
                await this.performTransition(client);
                return await this.execute(client);
            }
            throw err;
        }
    }

    private async performTransition(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Starting transition to new chat due to context limit...');

        // 1. Создаём свежий снимок перехода (с меткой "90") через ContextManager
        const snapshotFilePath = await client.contextManager.createTransitionSnapshot();
        if (!snapshotFilePath) {
            throw new Error('Failed to create transition snapshot');
        }
        console.log(`💾 Transition snapshot saved: ${snapshotFilePath}`);

        // 2. Создаём новый чат и сбрасываем контекст (флаги сбросятся)
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        // 3. Получаем самый свежий снимок (по времени) – это может быть либо снимок 70%, либо только что созданный снимок 90%
        const latestSnapshot = client.contextManager.getLatestSnapshotPath();
        if (!latestSnapshot) {
            throw new Error('No snapshot file available for upload');
        }

        // 4. Загружаем снимок в новый чат
        const uploadPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_upload_prompt.txt');
        let uploadPrompt = "Here is the context snapshot of our previous session (attached file). Please accept it and confirm by replying 'OK'.";
        if (fs.existsSync(uploadPromptPath)) {
            uploadPrompt = fs.readFileSync(uploadPromptPath, 'utf-8');
        }
        console.log('📤 Uploading snapshot file...');
        await client.executePipeline({ text: uploadPrompt, filePath: latestSnapshot, skipStatsUpdate: false });

        // 5. Сбрасываем флаг перехода
        client.needTransition = false;
        console.log('✅ Sync transition completed, retrying original request');
    }
}