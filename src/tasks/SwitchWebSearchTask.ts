// src/tasks/SwitchWebSearchTask.ts
/**
 * @file src/tasks/SwitchWebSearchTask.ts
 * Task for switching the Web Search toggle on or off.
 *
 * Included as a task rather than a direct method call so that the toggle
 * is applied inside TaskQueue, in order with the rest of the pipeline.
 * A user message that arrives with extra_body.web_search=true is preceded
 * by this task; when the field is absent, the toggle is explicitly set
 * to false to avoid leaking state from a previous request.
 *
 * Note: the Search toggle is not present in Expert mode. When the client
 * is in Expert mode, both enabling and disabling are no-ops — the call
 * logs a warning if enabling was requested.
 */

import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';

/**
 * Task for switching Web Search on/off.
 */
export class SwitchWebSearchTask extends Task<void> {
    /**
     * @param enabled - true to enable Web Search, false to disable it.
     */
    constructor(private enabled: boolean) {
        super(`Switch Web Search to ${enabled ? 'on' : 'off'}`, 'normal');
    }

    /**
     * Execute the task.
     *
     * @param client - DeepSeek client instance.
     * @returns Resolves once the toggle matches the requested state
     *          (or once a missing-toggle case has been logged).
     */
    async execute(client: DeepSeekClient): Promise<void> {
        await client.featureToggles.setWebSearch(this.enabled);
    }
}