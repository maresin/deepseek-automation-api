// src/rag/HistoryStore.ts
import path from 'path';
import fs from 'fs';
import { IEmbeddingService, IndexedItem, SearchResult, Exchange, FileChunk } from './types.js';
import { IVectorIndex, EadaVectorIndex } from './VectorIndex.js';

export class HistoryStore {
    private index: IVectorIndex;
    private embeddingService: IEmbeddingService;
    private dataDir: string;
    private sessionId: string;

    constructor(sessionId: string, embeddingService: IEmbeddingService, dataDir: string = './rag_data') {
        this.sessionId = sessionId;
        this.embeddingService = embeddingService;
        this.dataDir = dataDir;
        this.index = new EadaVectorIndex(384);
        this.ensureDataDir();
        this.loadIndex().catch(console.error);
    }

    private ensureDataDir(): void {
        const full = path.join(process.cwd(), this.dataDir);
        if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
    }

    private getIndexPath(): string {
        return path.join(process.cwd(), this.dataDir, `${this.sessionId}.index`);
    }

    private async loadIndex(): Promise<void> {
        const indexPath = this.getIndexPath();
        if (fs.existsSync(indexPath)) {
            await this.index.load(indexPath);
            console.log(`📚 Loaded index for session ${this.sessionId} (${this.index.size()} entries)`);
        }
    }

    private async saveIndex(): Promise<void> {
        await this.index.save(this.getIndexPath());
    }

    async addExchange(userMessage: string, assistantMessage: string): Promise<void> {
        const combined = `Q: ${userMessage}\nA: ${assistantMessage}`;
        const embedding = await this.embeddingService.embed(combined);
        const exchange: Exchange = {
            type: 'exchange',
            user: userMessage,
            assistant: assistantMessage,
            combined,
            timestamp: Date.now(),
            embedding
        };
        this.index.add(exchange, embedding);
        await this.saveIndex();
        console.log(`📝 Added exchange (${combined.length} chars) to history`);
    }

    async addFileChunk(fileName: string, chunkIndex: number, content: string): Promise<void> {
        const embedding = await this.embeddingService.embed(content);
        const chunk: FileChunk = {
            type: 'file',
            fileName,
            chunkIndex,
            content,
            timestamp: Date.now(),
            embedding
        };
        this.index.add(chunk, embedding);
        await this.saveIndex();
        console.log(`📎 Added file chunk ${fileName}[${chunkIndex}] (${content.length} chars)`);
    }

    async search(query: string, topK: number = 5): Promise<SearchResult[]> {
        const queryVec = await this.embeddingService.embed(query);
        return this.index.search(queryVec, topK);
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