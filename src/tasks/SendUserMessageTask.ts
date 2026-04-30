// src/tasks/SendUserMessageTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class SendUserMessageTask extends Task<string> {
    constructor(
        private text: string,
        private filePath?: string
    ) {
        const desc = filePath ? `Send message with file ${filePath}` : `Send message: ${text.substring(0, 50)}`;
        super(desc, 'normal');
        this.maxRetries = 0;
    }

    async execute(client: DeepSeekClient): Promise<string> {
        // Если системный промпт ещё не отправлен и он задан
        if (!client.isSystemPromptSent() && client.getSystemPromptText()) {
            console.log('📌 Sending system prompt before user message...');
            const systemPromptText = client.getSystemPromptText()!;
            await client.executePipeline({ text: systemPromptText });
            client.setSystemPromptSent(true);
            console.log('✅ System prompt sent and confirmed');
        }

        const response = await client.executePipeline({
            text: this.text,
            filePath: this.filePath
        });
        client.setChatStarted(true);
        return response;
    }
}