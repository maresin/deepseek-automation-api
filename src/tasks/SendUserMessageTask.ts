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
        this.maxRetries = 0; // никаких автоматических ретраев
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
        // 1. Отложенный переход по флагу (достигнут 90%)
        if (client.needTransition) {
            console.log('🚦 Performing pending transition due to high context usage');
            await this.performTransition(client);
            client.needTransition = false;
        }

        // 2. Системный промпт отправляется как обычный запрос (учитывается контекст)
        //    Но чтобы не повторять его после перехода, проверяем флаг.
        if (!client.isSystemPromptSent() && client.getSystemPromptText()) {
            console.log('📌 Sending system prompt before user message...');
            const systemPromptText = client.getSystemPromptText()!;
            await client.executePipeline({ text: systemPromptText, skipStatsUpdate: false });
            client.setSystemPromptSent(true);
            console.log('✅ System prompt sent and confirmed');
        }

        try {
            // 3. Проверка места в контексте
            let requiredChars = this.text.length;
            if (this.filePath) {
                requiredChars += this.getFileSizeInChars(this.filePath);
            }
            const canFit = await client.contextManager.canUploadFile(requiredChars);
            if (!canFit) {
                throw new NeedTransitionError(`Not enough context space for this message (need ${requiredChars} chars)`);
            }

            // 4. Отправка основного сообщения (статистика обновляется внутри)
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
                // Рекурсивный вызов – после перехода контекст чист, должно поместиться
                return await this.execute(client);
            }
            throw err;
        }
    }

    private async performTransition(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Starting transition to new chat due to context limit...');

        // 1. Создаём свежий снимок (учитываем его в контексте текущей сессии!)
        const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
        if (!fs.existsSync(snapshotPromptPath)) {
            throw new Error('Snapshot prompt file not found, cannot perform transition');
        }
        const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
        console.log('📸 Creating fresh snapshot for transition...');
        const wasDeepThink = await client.featureToggles.isDeepThinkEnabled();
        if (!wasDeepThink) await client.featureToggles.setDeepThink(true);
        // Снимок – это запрос к модели, его ответ тоже должен учитываться в контексте
        const snapshotContent = await client.executePipeline({ text: snapshotPrompt, skipStatsUpdate: false });
        if (!wasDeepThink) await client.featureToggles.setDeepThink(false);
        if (!snapshotContent || snapshotContent.trim().length === 0) {
            throw new Error('Failed to create snapshot: empty response');
        }

        // Сохраняем снимок во временный файл (уникальное имя)
        const snapshotFileName = `transition_snapshot_${Date.now()}.txt`;
        const snapshotFilePath = path.join(process.cwd(), 'uploads', snapshotFileName);
        fs.writeFileSync(snapshotFilePath, snapshotContent, 'utf-8');
        console.log(`💾 Transition snapshot saved to file: ${snapshotFilePath} (${snapshotContent.length} chars)`);

        // 2. Создаём новый чат (контекст сбрасывается, флаги тоже)
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        // 3. Загружаем снимок в новый чат (это тоже запрос к модели, учитываем контекст)
        const uploadPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_upload_prompt.txt');
        let uploadPrompt = "Here is the context snapshot of our previous session (attached file). Please accept it and confirm by replying 'OK'.";
        if (fs.existsSync(uploadPromptPath)) {
            uploadPrompt = fs.readFileSync(uploadPromptPath, 'utf-8');
        }
        console.log('📤 Uploading snapshot file with prompt...');
        await client.executePipeline({ text: uploadPrompt, filePath: snapshotFilePath, skipStatsUpdate: false });

        // 4. Удаляем временный файл снимка
        try {
            fs.unlinkSync(snapshotFilePath);
            console.log(`🧹 Deleted transition snapshot file: ${snapshotFilePath}`);
        } catch (e) {
            console.warn(`Failed to delete snapshot file: ${snapshotFilePath}`);
        }

        // 5. Сбрасываем флаг перехода (на всякий случай)
        client.needTransition = false;
        console.log('✅ Sync transition completed, retrying original request');
    }
}