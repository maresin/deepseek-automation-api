// src/tasks/TransitionAndRetryTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';
import { SendUserMessageTask } from './SendUserMessageTask.js';

export class TransitionAndRetryTask extends Task<void> {
    constructor(
        private text: string,
        private filePath?: string
    ) {
        super('Transition to new chat and retry', 'high');
        this.maxRetries = 0;
    }

    async execute(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Performing snapshot, transition, and retry...');

        const snapshotPromptPath = require('path').join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
        if (!require('fs').existsSync(snapshotPromptPath)) {
            console.warn('⚠️ Snapshot prompt not found, skipping snapshot creation');
        } else {
            const snapshotPrompt = require('fs').readFileSync(snapshotPromptPath, 'utf-8');
            console.log('📸 Creating snapshot for transition...');
            const wasDeepThink = await client.featureToggles.isDeepThinkEnabled();
            if (!wasDeepThink) await client.featureToggles.setDeepThink(true);
            await client.executePipeline({ text: snapshotPrompt });
            if (!wasDeepThink) await client.featureToggles.setDeepThink(false);
            console.log('✅ Snapshot created');
        }

        await client.newChat({ skipSystemPrompt: true });

        const snapshot = await client.contextManager.getSnapshot();
        if (snapshot && snapshot.length > 0) {
            console.log(`📤 Restoring snapshot (${snapshot.length} chars) in new chat...`);
            await client.executePipeline({ text: snapshot });
            await client.contextManager.resetContext(snapshot);
        } else {
            console.warn('⚠️ No snapshot to restore');
        }

        console.log('🔁 Retrying original task in new chat...');
        const retryTask = new SendUserMessageTask(this.text, this.filePath ? [this.filePath] : undefined);
        await client.taskQueue.add(retryTask, 'normal');

        console.log('✅ Transition and retry completed');
    }
}