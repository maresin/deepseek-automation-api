export class TaskScheduler {
    private queue: Array<() => Promise<any>> = [];
    private busy = false;

    async enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await task();
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