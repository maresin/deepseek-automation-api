// src/tasks/NewChatTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class NewChatTask extends Task<void> {
    constructor() {
        super('Create new chat', 'normal');
    }

    async execute(client: DeepSeekClient): Promise<void> {
        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        // Сбрасываем статистику контекста, так как чат пуст
        await client.contextManager.resetContext();
    }
}