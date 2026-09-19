// src/task/Task.ts
/**
 * @file src/task/Task.ts
 * Base class for every unit of work that is executed by TaskQueue.
 *
 * A Task describes one operation against DeepSeekClient (send a message,
 * switch a toggle, open a new chat). The queue serialises execution, so a
 * task can assume it is the only one touching the page at a time.
 *
 * Tasks support a simple retry policy: `maxRetries` is the number of
 * additional attempts after the first failure. The default (1) means two
 * total attempts.
 */

import { DeepSeekClient } from '../DeepSeekClient.js';

/**
 * Task priority. High-priority tasks are taken first when the queue is
 * drained, but they still run one at a time — the queue is a serialiser,
 * not a scheduler.
 */
export type TaskPriority = 'high' | 'normal';

export abstract class Task<T = any> {
    public priority: TaskPriority;
    public description: string;
    public retryCount: number = 0;
    protected maxRetries: number = 1;

    private _resolve?: (value: T) => void;
    private _reject?: (reason: any) => void;

    public readonly id: string;

    /**
     * @param description - Human-readable description used in logs.
     * @param priority    - Queue priority: 'high' or 'normal'.
     */
    constructor(description: string, priority: TaskPriority = 'normal') {
        this.id = Math.random().toString(36).substring(2, 10);
        this.description = description;
        this.priority = priority;
    }

    /**
     * Execute the task against the client. Implementations should throw on
     * failure; retry handling is performed by `run`.
     *
     * @param client - DeepSeek client instance.
     */
    abstract execute(client: DeepSeekClient): Promise<T>;

    /**
     * Run the task with retry handling. On success, resolves the promise
     * returned by TaskQueue.add; on final failure, rejects it.
     *
     * @param client - DeepSeek client instance.
     * @returns The result of the task's execute() method.
     */
    async run(client: DeepSeekClient): Promise<T> {
        try {
            const result = await this.execute(client);
            this._resolve?.(result);
            return result;
        } catch (error) {
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`Retrying task ${this.description} (${this.retryCount}/${this.maxRetries})`);
                return this.run(client);
            }
            this._reject?.(error);
            throw error;
        }
    }

    /**
     * Attach the promise resolvers used by TaskQueue.add.
     *
     * @param resolve - Called with the task result on success.
     * @param reject  - Called with the final error on failure.
     */
    setPromiseHandlers(resolve: (value: T) => void, reject: (reason: any) => void) {
        this._resolve = resolve;
        this._reject = reject;
    }
}