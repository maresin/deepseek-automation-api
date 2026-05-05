// src/task/TaskQueue.ts
import { DeepSeekClient } from '../DeepSeekClient.js';
import { Task, TaskPriority } from './Task.js';

export class TaskQueue {
    private highQueue: Task[] = [];
    private normalQueue: Task[] = [];
    private running = false;
    private client: DeepSeekClient;

    constructor(client: DeepSeekClient) {
        this.client = client;
    }

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

    public clear(): void {
        this.highQueue = [];
        this.normalQueue = [];
    }

    public get length(): number {
        return this.highQueue.length + this.normalQueue.length;
    }
}