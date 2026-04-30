// src/tasks/SwitchDeepThinkTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class SwitchDeepThinkTask extends Task<void> {
    constructor(private enabled: boolean) {
        super(`Switch DeepThink to ${enabled ? 'on' : 'off'}`, 'normal');
    }

    async execute(client: DeepSeekClient): Promise<void> {
        await client.featureToggles.setDeepThink(this.enabled);
    }
}