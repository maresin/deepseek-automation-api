// src/rag/init.ts
/**
 * @file src/rag/init.ts
 * RAG module entry point.
 *
 * Lazily initializes the embedding service on the first call to
 * getHistoryStore(), then caches one HistoryStore per session id.
 *
 * Exposes two ways to remove a session's data:
 *   - getHistoryStore() + store.clear()  : loads the embedding service,
 *                                          clears the in-memory store, and
 *                                          rewrites the index file.
 *   - clearHistoryStoreIfExists()        : cheap path that avoids loading
 *                                          the embedding model. Used from
 *                                          startFresh() during server
 *                                          startup, when the model is not
 *                                          yet needed.
 */

import path from 'path';
import fs from 'fs';
import { getEmbeddingService } from './EmbeddingService.js';
import { HistoryStore } from './HistoryStore.js';

const stores = new Map<string, HistoryStore>();
let embeddingService: any = null;

/**
 * Initialize the embedding service and prepare the module for use.
 * Idempotent: subsequent calls are no-ops once the service is loaded.
 */
export async function initRAG(): Promise<void> {
    if (embeddingService) return;
    console.log('🔧 Initializing RAG module with eada-cpu');
    embeddingService = await getEmbeddingService();
    console.log('✅ RAG module ready');
}

/**
 * Return the HistoryStore for a session, creating it on first access.
 *
 * @param sessionId - Session identifier (typically the API key).
 * @returns The cached or newly created HistoryStore.
 */
export async function getHistoryStore(sessionId: string): Promise<HistoryStore> {
    if (!embeddingService) {
        await initRAG();
    }
    if (!stores.has(sessionId)) {
        const store = new HistoryStore(
            sessionId,
            embeddingService,
            process.env.RAG_DATA_DIR || './rag_data'
        );
        stores.set(sessionId, store);
        console.log(`📚 Created HistoryStore for session ${sessionId}`);
    }
    return stores.get(sessionId)!;
}

/**
 * Clear the RAG index for a session without forcing the embedding service
 * to load.
 *
 * Two paths:
 *   - If the store is already in memory, its clear() is invoked (which
 *     empties the index and persists an empty file). The call is
 *     fire-and-forget: the caller does not wait for the persistence to
 *     complete, since nothing downstream depends on the exact timing.
 *   - Otherwise, the index file on disk is truncated in place, if present.
 *     This lets startFresh() during server startup drop stale data without
 *     paying the cost of loading the embedding model.
 *
 * @param sessionId - Session identifier (typically the API key).
 * @returns true if the store was cleared or the file was truncated.
 */
export function clearHistoryStoreIfExists(sessionId: string): boolean {
    if (stores.has(sessionId)) {
        stores.get(sessionId)!.clear().catch(err =>
            console.warn(`⚠️ Failed to clear in-memory store: ${err.message}`)
        );
        return true;
    }

    const dataDir = process.env.RAG_DATA_DIR || './rag_data';
    const filePath = path.join(process.cwd(), dataDir, `${sessionId}.linear.json`);

    if (fs.existsSync(filePath)) {
        try {
            fs.writeFileSync(filePath, '{"items":[],"vectors":[]}');
            console.log(`🧹 RAG index file truncated: ${filePath}`);
            return true;
        } catch (err) {
            console.warn(`⚠️ Failed to truncate ${filePath}: ${(err as Error).message}`);
            return false;
        }
    }

    return false;
}

if (typeof global !== 'undefined') {
    (global as any).__getHistoryStore = getHistoryStore;
}