// src/rag/HistoryStore.ts
import path from 'path';
import fs from 'fs';
import { IEmbeddingService, IndexedItem, SearchResult, Exchange, FileChunk } from './types.js';
import { IVectorIndex, LinearIndex } from './LinearIndex.js';

export class HistoryStore {
    private index: IVectorIndex;
    private embeddingService: IEmbeddingService;
    private dataDir: string;
    private sessionId: string;
    private chunkSize: number;

    constructor(sessionId: string, embeddingService: IEmbeddingService, dataDir: string = './rag_data') {
        this.sessionId = sessionId;
        this.embeddingService = embeddingService;
        this.dataDir = dataDir;
        this.index = new LinearIndex(384);
        this.chunkSize = parseInt(process.env.RAG_CHUNK_SIZE || '2000', 10);
        this.ensureDataDir();
        this.loadIndex().catch(console.error);
    }

    private ensureDataDir(): void {
        const full = path.join(process.cwd(), this.dataDir);
        if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
    }

    private getIndexPath(): string {
        return path.join(process.cwd(), this.dataDir, `${this.sessionId}`);
    }

    private async loadIndex(): Promise<void> {
        const indexPath = this.getIndexPath();
        try {
            await this.index.load(indexPath);
            console.log(`📚 Loaded index for session ${this.sessionId} (${this.index.size()} entries)`);
        } catch (err) {
            console.log(`No existing index for session ${this.sessionId}, starting fresh`);
        }
    }

    private async saveIndex(): Promise<void> {
        await this.index.save(this.getIndexPath());
    }

    private chunkText(text: string): string[] {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += this.chunkSize) {
            chunks.push(text.slice(i, i + this.chunkSize));
        }
        return chunks;
    }

    async addExchange(chatId: string, userMessage: string, assistantMessage: string): Promise<void> {
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
                embedding
            };
            this.index.add(exchangeChunk, embedding);
        }
        await this.saveIndex();
        console.log(`📝 Added exchange (${combined.length} chars, split into ${chunks.length} chunks) for chat ${chatId}`);
    }

    async addFileChunk(chatId: string, fileName: string, chunkIndex: number, content: string): Promise<void> {
        const embedding = await this.embeddingService.embed(content);
        const chunk: FileChunk = {
            type: 'file',
            chatId,
            fileName,
            chunkIndex,
            content,
            timestamp: Date.now(),
            embedding
        };
        this.index.add(chunk, embedding);
        await this.saveIndex();
        console.log(`📎 Added file chunk ${fileName}[${chunkIndex}] (${content.length} chars) for chat ${chatId}`);
    }

    async search(query: string, currentChatId: string, topK: number = 10): Promise<SearchResult[]> {
        const queryVec = await this.embeddingService.embed(query);
        let results = this.index.search(queryVec, topK * 2);

        results = results.filter(r => r.item.chatId !== currentChatId);
        results.sort((a, b) => b.similarity - a.similarity);
        return results.slice(0, topK);
    }

    async clear(): Promise<void> {
        this.index.clear();
        await this.saveIndex();
        console.log(`🗑️ HistoryStore cleared for session ${this.sessionId}`);
    }

    getEntryCount(): number {
        return this.index.size();
    }
}