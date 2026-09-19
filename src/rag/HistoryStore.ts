// src/rag/HistoryStore.ts
/**
 * @file src/rag/HistoryStore.ts
 * Persistent storage of conversation exchanges and file chunks for RAG.
 * Wraps a vector index and an embedding service, handles chunking,
 * search with current-chat exclusion, and persistence.
 *
 * Files are indexed as soon as they are attached to a chat. Exchanges are
 * indexed only after the chat has been marked as RAG-active, which happens
 * when a transition occurs from the previous session.
 *
 * The on-disk index is loaded asynchronously in the constructor. Every
 * public method awaits the `ready` promise so a request that arrives
 * immediately after a server restart cannot race against the load.
 */

import path from 'path';
import fs from 'fs';
import { IEmbeddingService, IndexedItem, SearchResult, Exchange, FileChunk } from './types.js';
import { IVectorIndex, LinearIndex } from './LinearIndex.js';

/**
 * HistoryStore manages the RAG index for a single session (one API key).
 * All data lives under rag_data/<sessionId>.linear.json.
 */
export class HistoryStore {
    private index: IVectorIndex;
    private embeddingService: IEmbeddingService | null = null;
    private dataDir: string;
    private sessionId: string;
    private chunkSize: number;
    private embeddingWarningLogged: boolean = false;

    /**
     * Resolves once the on-disk index has been loaded into memory. Every
     * method that touches the index awaits this promise first, so the very
     * first request after a restart cannot see an empty index while the
     * load is still in flight.
     */
    private ready: Promise<void>;

    /**
     * @param sessionId        - Unique session identifier (API key).
     * @param embeddingService - Embedding service for vector generation.
     * @param dataDir          - Directory for index files (default: ./rag_data).
     */
    constructor(sessionId: string, embeddingService: IEmbeddingService, dataDir: string = './rag_data') {
        this.sessionId = sessionId;
        this.embeddingService = embeddingService;
        this.dataDir = dataDir;
        this.index = new LinearIndex(384);
        this.chunkSize = parseInt(process.env.RAG_CHUNK_SIZE || '2000', 10);
        this.ensureDataDir();
        this.ready = this.loadIndex().catch(err => {
            console.error('Failed to load RAG index:', err);
        });
    }

    /**
     * Ensure the data directory exists.
     */
    private ensureDataDir(): void {
        const full = path.join(process.cwd(), this.dataDir);
        if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
    }

    /**
     * Absolute path (without extension) for the index of this session.
     */
    private getIndexPath(): string {
        return path.join(process.cwd(), this.dataDir, `${this.sessionId}`);
    }

    /**
     * Load the index from disk. Missing file is not an error.
     */
    private async loadIndex(): Promise<void> {
        const indexPath = this.getIndexPath();
        try {
            await this.index.load(indexPath);
            console.log(`📚 Loaded index for session ${this.sessionId} (${this.index.size()} entries)`);
        } catch {
            console.log(`No existing index for session ${this.sessionId}, starting fresh`);
        }
    }

    /**
     * Persist the current index to disk.
     */
    private async saveIndex(): Promise<void> {
        await this.index.save(this.getIndexPath());
    }

    /**
     * Split a text into chunks of approximately chunkSize characters.
     */
    private chunkText(text: string): string[] {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += this.chunkSize) {
            chunks.push(text.slice(i, i + this.chunkSize));
        }
        return chunks;
    }

    /**
     * Add a user/assistant exchange to the index.
     * The exchange is split into chunks; each chunk is embedded separately.
     */
    async addExchange(chatId: string, userMessage: string, assistantMessage: string): Promise<void> {
        await this.ready;

        if (!this.embeddingService) {
            if (!this.embeddingWarningLogged) {
                console.warn('⚠️ Embedding service not initialized, skipping exchange indexing');
                this.embeddingWarningLogged = true;
            }
            return;
        }

        const combined = `Q: ${userMessage}\nA: ${assistantMessage}`;
        const chunks = this.chunkText(combined);
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embedding = await this.embeddingService.embed(chunk);
            const exchangeChunk: Exchange = {
                type: 'exchange',
                chatId,
                user: userMessage,
                assistant: assistantMessage,
                combined: chunk,
                chunkIndex: i,
                totalChunks: chunks.length,
                timestamp: Date.now(),
                embedding,
            };
            this.index.add(exchangeChunk, embedding);
        }
        await this.saveIndex();
        console.log(`📝 Added exchange (${combined.length} chars, split into ${chunks.length} chunks) for chat ${chatId}`);
    }

    /**
     * Add a single file chunk to the index.
     * Does not persist to disk — call flushIndex() once after a batch of
     * addFileChunk() calls to avoid O(n^2) I/O.
     */
    async addFileChunk(chatId: string | null, fileName: string, chunkIndex: number, content: string): Promise<void> {
        await this.ready;

        if (!this.embeddingService) {
            if (!this.embeddingWarningLogged) {
                console.warn('⚠️ Embedding service not initialized, skipping file chunk indexing');
                this.embeddingWarningLogged = true;
            }
            return;
        }

        const embedding = await this.embeddingService.embed(content);
        const chunk: FileChunk = {
            type: 'file',
            chatId,
            fileName,
            chunkIndex,
            content,
            timestamp: Date.now(),
            embedding,
        };
        this.index.add(chunk, embedding);
    }

    /**
     * Persist the current index state to disk.
     * Call once after a batch of addFileChunk() calls.
     */
    async flushIndex(): Promise<void> {
        await this.ready;
        await this.saveIndex();
    }

    /**
     * Reassign every item whose chatId is currently null to a real chatId,
     * then persist the index.
     *
     * Files uploaded as the first message in a chat are indexed before
     * DeepSeek has assigned the chat an id, so they land with chatId = null.
     * Without this reassignment those chunks would never match the
     * "exclude current chat" filter and could leak into later searches.
     *
     * @param newChatId - Real chat id to assign.
     * @returns The number of items that were updated.
     */
    async reassignNullChatId(newChatId: string): Promise<number> {
        await this.ready;

        const changed = this.index.reassignChatId(null, newChatId);
        if (changed > 0) {
            await this.saveIndex();
            console.log(`📌 Reassigned ${changed} RAG item(s) from null to chatId ${newChatId}`);
        }
        return changed;
    }

    /**
     * Search the index for entries semantically close to the query.
     *
     * Two-stage ranking:
     *   1. A wider candidate pool is fetched by cosine similarity
     *      (topK * 4 results).
     *   2. Entries from the current chat are excluded, then a combined
     *      score blends semantic similarity with recency:
     *
     *        score = α * similarity + (1 - α) * recency
     *
     *      Recency is taken from the item's position in the store. The
     *      store is append-only, so position is a monotonic proxy for
     *      insertion time and requires no timestamp arithmetic.
     *
     * Environment knob (default in parentheses):
     *   RAG_SIMILARITY_WEIGHT   (0.7)  weight of cosine similarity
     *
     * @param query         - Search query.
     * @param currentChatId - Chat id whose entries should be skipped.
     * @param topK          - Maximum number of results to return.
     * @returns Results sorted by descending combined score.
     */
    async search(query: string, currentChatId: string | null, topK: number = 5): Promise<SearchResult[]> {
        await this.ready;

        if (!this.embeddingService) {
            if (!this.embeddingWarningLogged) {
                console.warn('⚠️ Embedding service not initialized, returning empty search results');
                this.embeddingWarningLogged = true;
            }
            return [];
        }

        const queryVec = await this.embeddingService.embed(query);

        // Fetch a wider candidate pool so a slightly-less-similar but much
        // fresher entry can still reach the final top-K.
        let candidates = this.index.search(queryVec, topK * 4);
        candidates = candidates.filter(r => r.item.chatId !== currentChatId);

        if (candidates.length === 0) return [];

        // Recency is a multiplicative bonus, not an additive term. This
        // keeps semantics as the primary signal: a very relevant but older
        // entry still beats a recent but unrelated one. The additive form
        // would fail because cosine similarity is naturally small (0.05-0.5)
        // while linear recency spans the full [0, 1] range.
        //
        // score = similarity * (W + (1 - W) * recency)
        //
        // W is the floor — the fraction of a similarity score that an
        // ancient item still retains. With W = 0.7, freshness gives at most
        // a ~1.43x boost over the oldest possible entry.
        //
        // Environment knob (default in parentheses):
        //   RAG_RECENCY_FLOOR   (0.7)  minimum multiplier for oldest items
        const W = parseFloat(process.env.RAG_RECENCY_FLOOR || '0.7');
        const totalItems = this.index.size();
        const denom = Math.max(1, totalItems - 1);

        const scored = candidates.map(r => {
            const recency = r.storeIndex / denom;   // 0 (oldest) … 1 (newest)
            const factor = W + (1 - W) * recency;   // W … 1
            const combined = r.similarity * factor;
            return {
                item: r.item,
                similarity: r.similarity,
                score: combined,
                storeIndex: r.storeIndex,
            };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    /**
     * Remove all entries from the index and persist the empty state.
     */
    async clear(): Promise<void> {
        await this.ready;
        this.index.clear();
        await this.saveIndex();
        console.log(`🗑️ HistoryStore cleared for session ${this.sessionId}`);
    }

    /**
     * Number of items currently held in the index.
     */
    getEntryCount(): number {
        return this.index.size();
    }
}