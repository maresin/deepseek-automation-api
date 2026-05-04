// src/rag/types.ts
export interface Exchange {
    type: 'exchange';
    chatId: string;          // идентификатор чата, к которому относится обмен
    user: string;
    assistant: string;
    combined: string;        // чанк
    chunkIndex: number;
    totalChunks: number;
    timestamp: number;
    embedding: number[];
}

export interface FileChunk {
    type: 'file';
    chatId: string;          // идентификатор чата, в котором загружен файл
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