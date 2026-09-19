// src/tasks/SwitchDeepThinkTask.ts
/**
 * @file src/tasks/SwitchDeepThinkTask.ts
 * Task for switching the DeepThink (R1) toggle on or off.
 *
 * Included as a task rather than a direct method call so that the toggle
 * is applied inside TaskQueue, in order with the rest of the pipeline.
 * A user message that arrives with extra_body.deepthink=true is preceded
 * by this task; when the field is absent, the toggle is explicitly set
 * to false to avoid leaking state from a previous request.
 */

import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

/**
 * Task for switching DeepThink on/off.
 */
export class SwitchDeepThinkTask extends Task<void> {
    /**
     * @param enabled - true to enable DeepThink, false to disable it.
     */
    constructor(private enabled: boolean) {
        super(`Switch DeepThink to ${enabled ? 'on' : 'off'}`, 'normal');
    }

    /**
     * Execute the task.
     *
     * @param client - DeepSeek client instance.
     * @returns Resolves once the toggle matches the requested state.
     */
    async execute(client: DeepSeekClient): Promise<void> {
        await client.featureToggles.setDeepThink(this.enabled);
    }
}