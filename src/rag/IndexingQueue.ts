// src/rag/IndexingQueue.ts
/**
 * @file src/rag/IndexingQueue.ts
 * Background queue for RAG file indexing.
 *
 * File uploads to DeepSeek UI are fast (seconds), but text chunking and
 * embedding on CPU can take minutes for large files. Running that work
 * inside the request handler blocks the client for the entire duration
 * and can hit undici's default 5-minute headersTimeout on the client
 * side. Moving it to a background queue decouples the two: the request
 * returns as soon as DeepSeek replies, and the file is indexed when the
 * worker gets around to it.
 *
 * The queue is a simple FIFO with a single worker. Jobs are not
 * persisted; if the process is killed, pending jobs are dropped and
 * their files are deleted during shutdown.
 *
 * Ownership rule: once a file is enqueued, the queue owns it and is
 * responsible for deleting it after indexing completes or fails.
 */

import fs from 'fs';
import path from 'path';
import { isIndexableFile, readTextFileSafe } from '../utils/fileUtils.js';

/**
 * One unit of work: a file to index into the RAG store of a session.
 */
export interface IndexingJob {
    /** Absolute path to the file. The queue deletes it when done. */
    filePath: string;
    /** Session identifier (API key) that owns the RAG store. */
    apiKey: string;
    /** Chat id this file belongs to. Always known — no null case. */
    chatId: string;
    /** File name shown in the log and stored with the chunk. */
    fileName: string;
}

export class IndexingQueue {
    private queue: IndexingJob[] = [];
    private busy: boolean = false;
    private shutdownRequested: boolean = false;

    /**
     * Add a job to the queue and start the worker if it is idle.
     * After the call returns, the queue owns the file and will delete
     * it once indexing completes (success or failure).
     *
     * If the queue is shutting down, the job is rejected immediately:
     * the file is deleted and a warning is logged.
     *
     * @param job - Job to enqueue.
     */
    enqueue(job: IndexingJob): void {
        if (this.shutdownRequested) {
            console.warn(`⚠️ [bg] Shutting down, dropping ${job.fileName}`);
            this.deleteFile(job.filePath);
            return;
        }
        this.queue.push(job);
        console.log(`📥 [bg] Enqueued ${job.fileName} (queue length: ${this.queue.length})`);
        void this.process();
    }

    /**
     * Worker loop. Runs jobs FIFO until the queue is empty or shutdown
     * is requested. Errors are logged and do not stop the loop.
     *
     * The re-check after `busy = false` closes a race: an enqueue that
     * arrives during the last iteration of the inner loop sees
     * `busy === true`, does not start a new worker, and would otherwise
     * leave its job stranded.
     */
    private async process(): Promise<void> {
        if (this.busy || this.shutdownRequested) return;
        this.busy = true;
        try {
            while (this.queue.length > 0 && !this.shutdownRequested) {
                const job = this.queue.shift()!;
                try {
                    await this.runJob(job);
                } catch (err) {
                    console.error(`❌ [bg] Indexing failed for ${job.fileName}:`, err);
                } finally {
                    this.deleteFile(job.filePath);
                }
            }
        } finally {
            this.busy = false;
        }

        // Race guard: a job may have been enqueued during the final
        // iteration, when `busy` was still true. Restart the worker.
        if (this.queue.length > 0 && !this.shutdownRequested) {
            void this.process();
        }
    }

    /**
     * Index a single file: read, chunk, embed, store.
     */
    private async runJob(job: IndexingJob): Promise<void> {
        const { filePath, apiKey, chatId, fileName } = job;

        // Service files must not be indexed:
        //   - snapshot.txt    : a summary of the chat, not new content
        //   - rag_context_*   : fragments reconstructed from the index
        //     itself. Re-indexing them would create a feedback loop that
        //     grows the index with copies of its own retrieved output.
        if (fileName.startsWith('snapshot') || fileName.startsWith('rag_context_')) {
            console.log(`ℹ️ [bg] Skipping service file: ${fileName}`);
            return;
        }

        if (!isIndexableFile(filePath)) {
            console.log(`ℹ️ [bg] Skipping non-text file: ${fileName}`);
            return;
        }

        const content = readTextFileSafe(filePath);
        if (!content) {
            console.warn(`⚠️ [bg] Could not read as text: ${fileName}`);
            return;
        }

        const { getHistoryStore } = await import('./init.js');
        const store = await getHistoryStore(apiKey);

        const chunkSize = parseInt(process.env.RAG_CHUNK_SIZE || '2000', 10);
        const chunks: string[] = [];
        for (let i = 0; i < content.length; i += chunkSize) {
            chunks.push(content.slice(i, i + chunkSize));
        }

        const t0 = Date.now();
        console.log(`📥 [bg] Indexing ${fileName}: ${chunks.length} chunk(s)...`);
        for (let i = 0; i < chunks.length; i++) {
            await store.addFileChunk(chatId, fileName, i, chunks[i]);
        }
        await store.flushIndex();
        const elapsed = Date.now() - t0;
        console.log(`✅ [bg] Indexed ${fileName}: ${chunks.length} chunk(s) in ${elapsed}ms`);
    }

    /**
     * Delete a file, ignoring errors (file may already be gone).
     */
    private deleteFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
            console.warn(`⚠️ [bg] Could not delete ${path.basename(filePath)}:`, err);
        }
    }

    /**
     * Stop accepting new jobs and wait for the current one to finish.
     * Remaining queued jobs are dropped; their files are deleted.
     *
     * @param timeoutMs - Maximum time to wait for the current job.
     */
    async shutdown(timeoutMs: number = 60000): Promise<void> {
        this.shutdownRequested = true;
        const deadline = Date.now() + timeoutMs;
        while (this.busy && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 200));
        }
        if (this.busy) {
            console.warn(`⚠️ [bg] Shutdown timeout: current job still running, abandoning`);
        }
        const pending = this.queue.length;
        if (pending > 0) {
            console.log(`🧹 [bg] Dropping ${pending} pending job(s) and deleting their files`);
        }
        for (const job of this.queue) {
            this.deleteFile(job.filePath);
        }
        this.queue = [];
    }

    /** Number of jobs waiting plus the currently running one (0 or 1). */
    get length(): number {
        return this.queue.length + (this.busy ? 1 : 0);
    }
}

let instance: IndexingQueue | null = null;

/**
 * Process-wide singleton accessor.
 */
export function getIndexingQueue(): IndexingQueue {
    if (!instance) instance = new IndexingQueue();
    return instance;
}