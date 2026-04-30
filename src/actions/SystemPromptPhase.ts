// src/actions/SystemPromptPhase.ts
import { DeepSeekClient } from '../DeepSeekClient.js';

export async function executeSystemPrompt(client: DeepSeekClient): Promise<void> {
    const message = client.config.systemPrompt;
    if (!message) return;

    const lastKey = await client.getMaxMessageKey();
    await client.chatController.clearInput();
    await client.chatController.typeMessage(message);
    await client.chatController.send();
    await client.waitForNewMessageKey(lastKey);
    const newKey = await client.getMaxMessageKey();
    const response = await client.responseExtractor.getResponseByKeyWithCopy(newKey);
    if (response && response.toLowerCase().includes('ok')) {
        client.setSystemPromptSent(true);
        console.log('✅ System prompt confirmed');
    } else {
        console.warn('⚠️ System prompt response not OK:', response);
        client.setSystemPromptSent(true);
    }
}