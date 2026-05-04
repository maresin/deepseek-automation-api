export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    embedding?: number[];
}

export interface SearchResult {
    message: Message;
    similarity: number;
}

export interface IEmbeddingService {
    embed(text: string): Promise<number[]>;
}