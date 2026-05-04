import { IEmbeddingService } from './types.js';

export class RealEmbeddingService implements IEmbeddingService {
    private embedder: any = null;
    private static instance: RealEmbeddingService | null = null;

    private constructor() {}

    static async getInstance(): Promise<RealEmbeddingService> {
        if (!RealEmbeddingService.instance) {
            RealEmbeddingService.instance = new RealEmbeddingService();
            await RealEmbeddingService.instance.init();
        }
        return RealEmbeddingService.instance;
    }

    private async init() {
        console.log('🔄 Loading embedding model (Xenova/all-MiniLM-L6-v2)...');
        const { pipeline } = await import('@xenova/transformers');
        this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('✅ Embedding model ready');
    }

    async embed(text: string): Promise<number[]> {
        if (!this.embedder) throw new Error('Embedder not initialized');
        const result = await this.embedder(text, { pooling: 'mean', normalize: true });
        return Array.from(result.data);
    }
}