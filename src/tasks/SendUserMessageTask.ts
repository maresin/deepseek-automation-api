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

    private async indexFileIfNeeded(client: DeepSeekClient): Promise<void> {
        // Безусловно проверяем, есть ли файл и включён ли RAG
        if (!this.filePath) {
            console.log('🔍 indexFileIfNeeded: no file path, skipping');
            return;
        }
        if (process.env.ENABLE_RAG !== 'true') {
            console.log('🔍 indexFileIfNeeded: RAG not enabled, skipping');
            return;
        }
        const apiKey = (global as any).currentApiKey;
        if (!apiKey) {
            console.log('🔍 indexFileIfNeeded: no apiKey, skipping');
            return;
        }
        console.log(`🔍 Indexing file: ${this.filePath} for chat ${client.currentChatId}`);
        try {
            const { getHistoryStore } = require('../../dist/rag/init.js');
            const store = await getHistoryStore(apiKey);
            const fileContent = fs.readFileSync(this.filePath, 'utf-8');
            const chunkSize = parseInt(process.env.RAG_CHUNK_SIZE || '2000', 10);
            const chunks: string[] = [];
            for (let i = 0; i < fileContent.length; i += chunkSize) {
                chunks.push(fileContent.slice(i, i + chunkSize));
            }
            console.log(`🔍 File ${path.basename(this.filePath)} split into ${chunks.length} chunks (size ${chunkSize})`);
            for (let i = 0; i < chunks.length; i++) {
                await store.addFileChunk(client.currentChatId, path.basename(this.filePath), i, chunks[i]);
            }
            console.log(`📎 Indexed ${chunks.length} chunks from file ${path.basename(this.filePath)} for chat ${client.currentChatId}`);
        } catch (err) {
            console.error('❌ Failed to index file chunks:', err);
        }
    }

    async execute(client: DeepSeekClient): Promise<string> {
        // 1. Индексация файла (всегда, если файл есть и RAG включён)
        await this.indexFileIfNeeded(client);

        // 2. Проверка отложенного перехода
        if (client.needTransition) {
            console.log('🚦 needTransition flag set, performing transition...');
            await this.performTransition(client);
            client.needTransition = false;
        }

        // 3. Системный промпт
        if (!client.isSystemPromptSent() && client.getSystemPromptText()) {
            console.log('📌 Sending system prompt before user message...');
            const systemPromptText = client.getSystemPromptText()!;
            await client.executePipeline({ text: systemPromptText, skipStatsUpdate: true });
            client.setSystemPromptSent(true);
            console.log('✅ System prompt sent and confirmed');
        }

        // 4. Проверка, влезает ли сообщение/файл в контекст
        let requiredChars = this.text.length;
        if (this.filePath) {
            requiredChars += this.getFileSizeInChars(this.filePath);
        }
        const stats = await client.contextManager.getStats();
        const currentTotal = stats.totalChars;
        const maxChars = stats.maxChars;
        const wouldBeTotal = currentTotal + requiredChars;
        const wouldBePercent = (wouldBeTotal / maxChars) * 100;

        if (wouldBePercent > 90) {
            console.log(`📊 Would be ${wouldBePercent.toFixed(1)}% after adding message. Initiating transition.`);
            if (wouldBePercent <= 95 && client.contextManager.canCreateTransitionSnapshot(requiredChars)) {
                console.log('📸 Creating transition snapshot (90-95%)...');
                await client.contextManager.createTransitionSnapshot();
            } else {
                console.log('⚠️ Would exceed 95% – skipping snapshot creation, using existing snapshot.');
            }
            await this.performTransition(client);
            return await this.execute(client);
        }

        // 5. Отправка сообщения
        try {
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
        const latestSnapshot = client.contextManager.getLatestSnapshotPath();
        if (!latestSnapshot) {
            throw new Error('No snapshot available for transition');
        }

        // Создаём новый чат через интерфейс браузера
        await client.chatController.newChat();
        
        // ✅ Генерируем новый ID для перешедшего чата
        client.currentChatId = Date.now().toString();
        console.log(`🆕 New chat created with ID: ${client.currentChatId} (after transition)`);
        
        // Сбрасываем флаги состояния
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        // Загружаем снимок
        const uploadPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_upload_prompt.txt');
        let uploadPrompt = "Here is the context snapshot of our previous session (attached file). Please accept it and confirm by replying 'OK'.";
        if (fs.existsSync(uploadPromptPath)) {
            uploadPrompt = fs.readFileSync(uploadPromptPath, 'utf-8');
        }
        console.log('📤 Uploading snapshot file...');
        await client.executePipeline({ text: uploadPrompt, filePath: latestSnapshot, skipStatsUpdate: false });

        client.inRefreshedChat = true;
        client.needTransition = false;
        console.log('✅ Transition completed, RAG search will be active with new chat ID');
    }
}