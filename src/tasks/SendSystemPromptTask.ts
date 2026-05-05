// src/tasks/SendSystemPromptTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class SendSystemPromptTask extends Task<void> {
    constructor() {
        super('Send system prompt', 'normal');
        this.maxRetries = 2;
    }

    async execute(client: DeepSeekClient): Promise<void> {
        if (client.isSystemPromptSent()) {
            console.log('System prompt already sent, skipping');
            return;
        }
        const promptText = client.getSystemPromptText();
        if (!promptText) {
            console.warn('No system prompt text configured, skipping');
            return;
        }
        const response = await client.executePipeline({ text: promptText });
        if (!response.toLowerCase().includes('ok')) {
            throw new Error('System prompt response did not contain "OK"');
        }
        client.setSystemPromptSent(true);
        console.log('✅ System prompt confirmed');
    }
}