// src/rag/LinearIndex.ts
/**
 * @file src/rag/LinearIndex.ts
 * Linear vector index backed by a plain JSON file.
 *
 * No external dependency (FAISS or similar) is used: every search scans
 * all stored vectors and computes cosine similarity. This is fast enough
 * for the expected scale — up to several thousand chunks — and keeps the
 * deployment footprint minimal.
 */

import { IndexedItem, SearchResult } from './types.js';

/**
 * Common interface for a vector index.
 */
export interface IVectorIndex {
    add(item: IndexedItem, vector: number[]): void;
    search(queryVector: number[], topK: number): SearchResult[];
    save(path: string): Promise<void>;
    load(path: string): Promise<void>;
    clear(): void;
    size(): number;

    /**
     * Update the chatId of every item whose current chatId equals fromChatId.
     *
     * Used to attach file chunks that were indexed before the chat received
     * its real id. Called from HistoryStore.reassignNullChatId with
     * fromChatId = null.
     *
     * @param fromChatId - Current chatId value to match (may be null).
     * @param toChatId   - New chatId value to assign.
     * @returns The number of items that were updated.
     */
    reassignChatId(fromChatId: string | null, toChatId: string): number;
}

/**
 * Simple in-memory index with linear search.
 * Persisted as a single JSON file next to the session id.
 */
export class LinearIndex implements IVectorIndex {
    private items: IndexedItem[] = [];
    private vectors: number[][] = [];

    constructor(_dimension?: number) {}

    add(item: IndexedItem, vector: number[]): void {
        this.items.push(item);
        this.vectors.push(vector);
    }

    search(queryVector: number[], topK: number): SearchResult[] {
        const scores: { idx: number; sim: number }[] = [];
        for (let i = 0; i < this.vectors.length; i++) {
            const sim = this.cosineSimilarity(queryVector, this.vectors[i]);
            scores.push({ idx: i, sim });
        }
        scores.sort((a, b) => b.sim - a.sim);
        return scores.slice(0, topK).map(s => ({
            item: this.items[s.idx],
            similarity: s.sim,
            // At the index level, similarity and score are the same.
            // HistoryStore.search overrides score with the combined
            // (semantic + recency) value before returning to callers.
            score: s.sim,
            storeIndex: s.idx,
        }));
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        if (magA === 0 || magB === 0) return 0;
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    async save(path: string): Promise<void> {
        const fs = await import('fs/promises');
        const data = { items: this.items, vectors: this.vectors };
        await fs.writeFile(path + '.linear.json', JSON.stringify(data));
    }

    async load(path: string): Promise<void> {
        const fs = await import('fs/promises');
        try {
            const raw = await fs.readFile(path + '.linear.json', 'utf-8');
            const data = JSON.parse(raw);
            this.items = data.items;
            this.vectors = data.vectors;
        } catch {
            console.warn('No saved linear index found, starting empty');
        }
    }

    clear(): void {
        this.items = [];
        this.vectors = [];
    }

    size(): number {
        return this.items.length;
    }

    reassignChatId(fromChatId: string | null, toChatId: string): number {
        let changed = 0;
        for (const item of this.items) {
            if (item.chatId === fromChatId) {
                item.chatId = toChatId;
                changed++;
            }
        }
        return changed;
    }
}

export { LinearIndex as EadaVectorIndex };