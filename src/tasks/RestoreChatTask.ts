// src/tasks/RestoreChatTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class RestoreChatTask extends Task<void> {
    constructor() {
        super('Restore last chat', 'normal');
    }

    async execute(client: DeepSeekClient): Promise<void> {
        const restored = await client.restoreLastChat();
        if (restored) {
            client.setChatStarted(true);
            client.setSystemPromptSent(true);
        } else {
            await client.chatController.newChat();
            client.setChatStarted(false);
            client.setSystemPromptSent(false);
        }
    }
}