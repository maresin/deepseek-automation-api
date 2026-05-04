import { HistoryStore } from './HistoryStore.js';

const sessionStores: Map<string, HistoryStore> = new Map();

export function setHistoryStore(sessionId: string, store: HistoryStore): void {
    sessionStores.set(sessionId, store);
}

export function getHistoryStore(sessionId: string): HistoryStore | undefined {
    return sessionStores.get(sessionId);
}

export function getRAGTool(): any {
    return {
        type: "function",
        function: {
            name: "search_conversation",
            description: "Search previous conversation history for relevant information.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" }
                },
                required: ["query"]
            }
        }
    };
}

export async function handleRAGCall(sessionId: string, args: string): Promise<string> {
    let query = '';
    try {
        query = JSON.parse(args).query;
    } catch (e) {
        return `Error parsing arguments: ${e}`;
    }
    const store = sessionStores.get(sessionId);
    if (!store) return `No history store for session ${sessionId}`;
    try {
        const results = await store.search(query, 3);
        if (results.length === 0) return `No relevant information found for "${query}".`;
        return results.map((r, i) => 
            `[${i+1}] (score: ${r.similarity.toFixed(3)}): ${r.message.content.substring(0, 500)}`
        ).join('\n---\n');
    } catch (err) {
        return `Search failed: ${err}`;
    }
}