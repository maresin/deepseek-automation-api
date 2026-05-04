import path from 'path';
import fs from 'fs';
import { IEmbeddingService } from './types.js';
import { IVectorIndex, EadaVectorIndex } from './VectorIndex.js';
import { Message, SearchResult } from './types.js';

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
        this.loadIndex();
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

    async addMessage(role: Message['role'], content: string): Promise<void> {
        const message: Message = {
            role,
            content,
            timestamp: Date.now(),
        };
        if (role === 'user') {
            message.embedding = await this.embeddingService.embed(content);
        }
        if (message.embedding) {
            this.index.add(message, message.embedding);
            await this.saveIndex();
        }
    }

    async search(query: string, topK: number = 3): Promise<SearchResult[]> {
        const queryVec = await this.embeddingService.embed(query);
        return this.index.search(queryVec, topK);
    }

    async clear(): Promise<void> {
        this.index.clear();
        await this.saveIndex();
    }

    getMessageCount(): number {
        return this.index.size();
    }
}