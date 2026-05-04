// src/rag/types.ts
export interface Exchange {
    type: 'exchange';
    user: string;
    assistant: string;
    combined: string;
    timestamp: number;
    embedding: number[];
}

export interface FileChunk {
    type: 'file';
    fileName: string;
    chunkIndex: number;
    content: string;
    timestamp: number;
    embedding: number[];
}

export type IndexedItem = Exchange | FileChunk;

export interface SearchResult {
    item: IndexedItem;
    similarity: number;
}

export interface IEmbeddingService {
    embed(text: string): Promise<number[]>;
}