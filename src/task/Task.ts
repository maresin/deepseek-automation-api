// src/task/Task.ts
import { DeepSeekClient } from '../DeepSeekClient.js';

export type TaskPriority = 'high' | 'normal';

export abstract class Task<T = any> {
    public priority: TaskPriority;
    public description: string;
    public retryCount: number = 0;
    protected maxRetries: number = 1;
    private _resolve?: (value: T) => void;
    private _reject?: (reason: any) => void;
    public readonly id: string;

    constructor(description: string, priority: TaskPriority = 'normal') {
        this.id = Math.random().toString(36).substring(2, 10);
        this.description = description;
        this.priority = priority;
    }

    abstract execute(client: DeepSeekClient): Promise<T>;

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

    setPromiseHandlers(resolve: (value: T) => void, reject: (reason: any) => void) {
        this._resolve = resolve;
        this._reject = reject;
    }
}