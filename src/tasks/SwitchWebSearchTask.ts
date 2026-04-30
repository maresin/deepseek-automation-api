// src/tasks/SwitchWebSearchTask.ts
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class SwitchWebSearchTask extends Task<void> {
    constructor(private enabled: boolean) {
        super(`Switch Web Search to ${enabled ? 'on' : 'off'}`, 'normal');
    }

    async execute(client: DeepSeekClient): Promise<void> {
        await client.featureToggles.setWebSearch(this.enabled);
    }
}