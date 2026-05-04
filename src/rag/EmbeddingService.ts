import { IEmbeddingService } from './types.js';
import { RealEmbeddingService } from './RealEmbeddingService.js';

export async function getEmbeddingService(): Promise<IEmbeddingService> {
    console.log('🤖 Using RealEmbeddingService (Xenova/all-MiniLM-L6-v2)');
    return await RealEmbeddingService.getInstance();
}