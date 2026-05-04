import path from 'path';
import fs from 'fs';
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';
import { NeedTransitionError } from '../file/FileUploader.js';

// Импортируем функции управления RAG-флагом из chat.js (CommonJS)
// @ts-ignore
const chatRoute = require('../../server-modules/routes/chat.js');

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

    private getApiKey(): string {
        // Апи ключ обычно передаётся в заголовке, но в контексте задачи у нас нет прямого доступа к req.
        // Для простоты будем использовать фиксированный идентификатор сессии.
        // В реальном проекте нужно передавать apiKey через глобальный контекст или сохранять в client.
        return (global as any).currentApiKey || 'default-api-key';
    }

    private async initRAGMode(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Switching to RAG mode (snapshot replaced by RAG)');
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        const apiKey = this.getApiKey();
        chatRoute.setUseRAG(apiKey, true);

        const ragInstruction = `You are continuing a conversation that was previously too long. 
You no longer have the full history in your context window. 
However, you can use the tool "search_conversation" to retrieve relevant parts of the history. 
When you need to recall previous information, call this tool with a query.`;
        await client.executePipeline({ text: ragInstruction, skipStatsUpdate: false });
        console.log('✅ RAG mode activated');
    }

    async execute(client: DeepSeekClient): Promise<string> {
        // Отложенный переход по флагу (достигнут 90%)
        if (client.needTransition) {
            console.log('🚦 Performing pending transition due to high context usage');
            await this.performTransition(client);
            client.needTransition = false;
        }

        // Системный промпт (если ещё не отправлен)
        if (!client.isSystemPromptSent() && client.getSystemPromptText()) {
            console.log('📌 Sending system prompt before user message...');
            const systemPromptText = client.getSystemPromptText()!;
            await client.executePipeline({ text: systemPromptText, skipStatsUpdate: true });
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
        if (process.env.ENABLE_RAG === 'true') {
            await this.initRAGMode(client);
            return;
        }

        // Оригинальная логика со снимками (если RAG выключен)
        console.log('🔄 Starting transition to new chat due to context limit...');

        const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
        if (!fs.existsSync(snapshotPromptPath)) {
            throw new Error('Snapshot prompt file not found');
        }
        const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
        console.log('📸 Creating fresh snapshot for transition...');
        const wasDeepThink = await client.featureToggles.isDeepThinkEnabled();
        if (!wasDeepThink) await client.featureToggles.setDeepThink(true);
        const snapshotContent = await client.executePipeline({ text: snapshotPrompt, skipStatsUpdate: false });
        if (!wasDeepThink) await client.featureToggles.setDeepThink(false);
        if (!snapshotContent || snapshotContent.trim().length === 0) {
            throw new Error('Failed to create snapshot: empty response');
        }

        const snapshotFileName = `transition_snapshot_${Date.now()}.txt`;
        const snapshotFilePath = path.join(process.cwd(), 'uploads', snapshotFileName);
        fs.writeFileSync(snapshotFilePath, snapshotContent, 'utf-8');
        console.log(`💾 New transition snapshot saved: ${snapshotFilePath} (${snapshotContent.length} chars)`);

        await client.contextManager.replaceSnapshotFile(snapshotFilePath);

        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        const uploadPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_upload_prompt.txt');
        let uploadPrompt = "Here is the context snapshot of our previous session (attached file). Please accept it and confirm by replying 'OK'.";
        if (fs.existsSync(uploadPromptPath)) {
            uploadPrompt = fs.readFileSync(uploadPromptPath, 'utf-8');
        }
        console.log('📤 Uploading snapshot file...');
        const currentSnapshotPath = client.contextManager.getSnapshotFilePath();
        if (!currentSnapshotPath) {
            throw new Error('No snapshot file available for upload');
        }
        await client.executePipeline({ text: uploadPrompt, filePath: currentSnapshotPath, skipStatsUpdate: false });

        try { if (fs.existsSync(snapshotFilePath)) fs.unlinkSync(snapshotFilePath); } catch(e) {}

        client.needTransition = false;
        console.log('✅ Sync transition completed, retrying original request');
    }
}