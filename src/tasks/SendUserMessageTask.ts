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

        // Устанавливаем флаг RAG для этой сессии
        const apiKey = (global as any).currentApiKey || 'default-api-key';
        const { setUseRAG } = require('../../server-modules/routes/chat.js');
        setUseRAG(apiKey, true);

        // Отправляем системный промпт из файла (вместо короткого сообщения)
        const systemPromptPath = path.join(process.cwd(), 'prompts', 'rag_system_prompt.txt');
        let ragInstruction = "You can use search_conversation tool to retrieve history.";
        if (fs.existsSync(systemPromptPath)) {
            ragInstruction = fs.readFileSync(systemPromptPath, 'utf-8');
        } else {
            console.warn('rag_system_prompt.txt not found, using default');
        }
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
        console.log('🔄 Starting transition to new chat due to context limit...');

        // 1. Создаём снимок (всегда)
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

        // 2. Заменяем старый снимок
        await client.contextManager.replaceSnapshotFile(snapshotFilePath);

        // 3. Создаём новый чат и сбрасываем контекст
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        // 4. Загружаем снимок (всегда)
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

        // 5. Удаляем временный файл
        try { if (fs.existsSync(snapshotFilePath)) fs.unlinkSync(snapshotFilePath); } catch(e) {}

        client.needTransition = false;
        console.log('✅ Sync transition completed');

        // 6. Если RAG включён, активируем RAG-режим (это не отменяет снимок, а добавляет поиск)
        if (process.env.ENABLE_RAG === 'true') {
            const apiKey = (global as any).currentApiKey;
            if (apiKey) {
                console.log('🔧 Activating RAG mode for session', apiKey);
                const { setUseRAG } = require('../../server-modules/routes/chat.js');
                setUseRAG(apiKey, true);
            }
        }

        // Повторяем исходный запрос (если нужно)
        if (this.text || this.filePath) {
            console.log('🔄 Retrying original request after transition');
        }
    }
}