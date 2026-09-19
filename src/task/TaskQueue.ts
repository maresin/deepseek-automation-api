// src/task/TaskQueue.ts
/**
 * @file src/task/TaskQueue.ts
 * Serial queue for tasks that interact with the DeepSeek UI.
 *
 * Only one task is executed at any given moment. Tasks are kept in two
 * priority buckets; high-priority tasks are taken before normal ones, but
 * the ordering within a bucket is FIFO. The queue never runs two tasks in
 * parallel — the underlying browser page is a single shared resource.
 */

import { DeepSeekClient } from '../DeepSeekClient.js';
import { Task, TaskPriority } from './Task.js';

export class TaskQueue {
    private highQueue: Task[] = [];
    private normalQueue: Task[] = [];
    private running = false;
    private client: DeepSeekClient;

    /**
     * @param client - DeepSeek client instance passed to each task's run().
     */
    constructor(client: DeepSeekClient) {
        this.client = client;
    }

    /**
     * Add a task to the queue. The returned promise resolves with the
     * task result, or rejects with the final error after retries.
     *
     * @param task     - Task instance.
     * @param priority - 'high' or 'normal'. Defaults to 'normal'.
     */
    add<T>(task: Task<T>, priority: TaskPriority = 'normal'): Promise<T> {
        return new Promise((resolve, reject) => {
            task.setPromiseHandlers(resolve, reject);
            if (priority === 'high') {
                this.highQueue.push(task);
            } else {
                this.normalQueue.push(task);
            }
            this.process();
        });
    }

    /**
     * Drain the queue until both buckets are empty. Reentrant calls are
     * no-ops: the first caller owns the loop, everyone else returns
     * immediately. Any exception thrown by a task is caught and logged;
     * the loop continues with the next task.
     */
    private async process(): Promise<void> {
        if (this.running) return;
        this.running = true;

        while (this.highQueue.length > 0 || this.normalQueue.length > 0) {
            const task = this.highQueue.shift() ?? this.normalQueue.shift();
            if (!task) continue;

            console.log(`▶️ Executing task: ${task.description} (${task.priority})`);
            const start = Date.now();
            try {
                await task.run(this.client);
                const duration = Date.now() - start;
                console.log(`✅ Task completed: ${task.description} (${duration}ms)`);
            } catch (error) {
                console.error(`❌ Task failed: ${task.description}`, error);
            }
        }

        this.running = false;
    }

    /**
     * Remove all pending tasks from both buckets. Does not interrupt the
     * task that is currently running.
     */
    public clear(): void {
        this.highQueue = [];
        this.normalQueue = [];
    }

    /**
     * Number of tasks waiting in both buckets (excludes the running task).
     */
    public get length(): number {
        return this.highQueue.length + this.normalQueue.length;
    }
}