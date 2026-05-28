import path from 'path';
import fs from 'fs';
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';
import { NeedTransitionError } from '../file/FileUploader.js';

export class SendUserMessageTask extends Task<string> {
    constructor(
        private text: string,
        private filePaths?: string[]
    ) {
        const desc = filePaths && filePaths.length
            ? `Send message with ${filePaths.length} file(s)`
            : `Send message: ${text.substring(0, 50)}`;
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

    private async indexFileIfNeeded(client: DeepSeekClient, filePath: string): Promise<void> {
        if (!filePath || process.env.ENABLE_RAG !== 'true') return;
        const apiKey = (global as any).currentApiKey;
        if (!apiKey) return;
        try {
            const { getHistoryStore } = require('../../dist/rag/init.js');
            const store = await getHistoryStore(apiKey);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const chunkSize = parseInt(process.env.RAG_CHUNK_SIZE || '2000', 10);
            const chunks: string[] = [];
            for (let i = 0; i < fileContent.length; i += chunkSize) {
                chunks.push(fileContent.slice(i, i + chunkSize));
            }
            for (let i = 0; i < chunks.length; i++) {
                await store.addFileChunk(client.currentChatId, path.basename(filePath), i, chunks[i]);
            }
            console.log(`📎 Indexed ${chunks.length} chunks from file ${path.basename(filePath)} for chat ${client.currentChatId}`);
        } catch (err) {
            console.error('Failed to index file chunks:', err);
        }
    }

    async execute(client: DeepSeekClient): Promise<string> {
        // 1. Индексация всех файлов
        if (this.filePaths && this.filePaths.length) {
            for (const fp of this.filePaths) {
                await this.indexFileIfNeeded(client, fp);
            }
        }

        // 2. Отложенный переход
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

        // 4. Проверка контекста (учитываем все файлы)
        let requiredChars = this.text.length;
        if (this.filePaths && this.filePaths.length) {
            for (const fp of this.filePaths) {
                requiredChars += this.getFileSizeInChars(fp);
            }
        }
        const stats = await client.contextManager.getStats();
        const wouldBePercent = ((stats.totalChars + requiredChars) / stats.maxChars) * 100;

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

        // 5. Прикрепляем файлы один за другим
        if (this.filePaths && this.filePaths.length) {
            for (const fp of this.filePaths) {
                await client.fileUploader.upload(fp);
                await client.page!.waitForTimeout(500); // небольшая пауза между файлами
            }
        }

        // 6. Отправка текстового сообщения (файлы уже прикреплены)
        const response = await client.executePipeline({
            text: this.text,
            filePath: undefined, // не передаём файл, т.к. уже прикрепили
            skipStatsUpdate: false
        });
        client.setChatStarted(true);
        return response;
    }

    private async performTransition(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Starting transition to new chat due to context limit...');
        const latestSnapshot = client.contextManager.getLatestSnapshotPath();
        if (!latestSnapshot) {
            throw new Error('No snapshot available for transition');
        }

        await client.chatController.newChat();
        client.currentChatId = Date.now().toString();
        console.log(`🆕 New chat created with ID: ${client.currentChatId} (after transition)`);
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

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