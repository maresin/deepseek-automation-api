// src/tasks/SwitchExpertModeTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class SwitchExpertModeTask extends Task<void> {
    constructor(private enabled: boolean) {
        super(`Switch expert mode to ${enabled ? 'Expert' : 'Instant'}`, 'normal');
    }

    async execute(client: DeepSeekClient): Promise<void> {
        if (client.isChatStarted()) {
            console.warn('Cannot change expert mode after first message');
            return;
        }
        await client.featureToggles.setExpertMode(this.enabled);
    }
}