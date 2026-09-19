// src/rag/types.ts
/**
 * @file src/rag/types.ts
 * Shared type definitions for the RAG subsystem.
 *
 * Two kinds of items are stored in the index:
 *   - Exchange : a user/assistant message pair, indexed only after the
 *                chat has been marked as active for RAG search.
 *   - FileChunk: a fragment of a text file uploaded to the chat.
 *
 * Both carry a chatId. It is nullable because file chunks can be indexed
 * before DeepSeek has assigned an id to the new chat (the id is assigned
 * only after the first assistant reply). Such chunks are stored with
 * chatId = null and reassigned later via HistoryStore.reassignNullChatId.
 */

/**
 * A user/assistant exchange.
 */
export interface Exchange {
    type: 'exchange';
    chatId: string | null;
    user: string;
    assistant: string;
    combined: string;
    chunkIndex: number;
    totalChunks: number;
    timestamp: number;
    embedding: number[];
}

/**
 * A single chunk of an uploaded file.
 */
export interface FileChunk {
    type: 'file';
    chatId: string | null;
    fileName: string;
    chunkIndex: number;
    content: string;
    timestamp: number;
    embedding: number[];
}

/**
 * Union of everything the RAG index can hold.
 */
export type IndexedItem = Exchange | FileChunk;

/**
 * A single search result.
 *
 * `score` blends semantic similarity with recency and is the value used
 * for ranking. `similarity` is the raw cosine similarity of the embedding.
 * `storeIndex` is the item's position in the underlying store, where a
 * higher value means a more recent insertion.
 */
export interface SearchResult {
    item: IndexedItem;
    similarity: number;
    score: number;
    storeIndex: number;
}

/**
 * Interface implemented by the embedding service.
 */
export interface IEmbeddingService {
    embed(text: string): Promise<number[]>;
}