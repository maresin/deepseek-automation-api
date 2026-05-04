import { getEmbeddingService } from './EmbeddingService.js';
import { HistoryStore } from './HistoryStore.js';
import { setHistoryStore } from './ragTools.js';

const globalStores = new Map<string, HistoryStore>();

export async function initRAG(): Promise<void> {
    console.log('🔧 Initializing RAG module with eada-cpu');
    const embeddingService = await getEmbeddingService();
    (global as any).__getRAGStore = async (sessionId: string) => {
        if (!globalStores.has(sessionId)) {
            const store = new HistoryStore(sessionId, embeddingService, process.env.RAG_DATA_DIR || './rag_data');
            globalStores.set(sessionId, store);
            setHistoryStore(sessionId, store);
            console.log(`📚 Created HistoryStore for session ${sessionId}`);
        }
        return globalStores.get(sessionId)!;
    };
    console.log('✅ RAG module ready');
}