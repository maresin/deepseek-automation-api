// src/actions/ActionQueue.ts
type AsyncFunction<T = any> = () => Promise<T>;

export class ActionQueue {
    private queue: AsyncFunction[] = [];
    private busy = false;

    enqueue<T>(action: AsyncFunction<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await action();
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });
            this.process();
        });
    }

    private async process(): Promise<void> {
        if (this.busy || this.queue.length === 0) return;
        this.busy = true;
        const next = this.queue.shift();
        if (next) await next();
        this.busy = false;
        this.process();
    }
}