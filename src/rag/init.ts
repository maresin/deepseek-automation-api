import { getEmbeddingService } from './EmbeddingService.js';
import { HistoryStore } from './HistoryStore.js';

const stores = new Map<string, HistoryStore>();
let embeddingService: any = null;

export async function initRAG(): Promise<void> {
    console.log('🔧 Initializing RAG module with eada-cpu');
    embeddingService = await getEmbeddingService();
    console.log('✅ RAG module ready');
}

export async function getHistoryStore(sessionId: string): Promise<HistoryStore> {
    if (!embeddingService) {
        await initRAG();
    }
    if (!stores.has(sessionId)) {
        const store = new HistoryStore(sessionId, embeddingService, process.env.RAG_DATA_DIR || './rag_data');
        stores.set(sessionId, store);
        console.log(`📚 Created HistoryStore for session ${sessionId}`);
    }
    return stores.get(sessionId)!;
}

if (typeof global !== 'undefined') {
    (global as any).__getHistoryStore = getHistoryStore;
}