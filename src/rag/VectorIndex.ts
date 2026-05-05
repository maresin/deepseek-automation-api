import { IndexedItem, SearchResult } from './types.js';

export interface IVectorIndex {
    add(item: IndexedItem, vector: number[]): void;
    search(queryVector: number[], topK: number): SearchResult[];
    save(path: string): Promise<void>;
    load(path: string): Promise<void>;
    clear(): void;
    size(): number;
}

export class LinearIndex implements IVectorIndex {
    private items: IndexedItem[] = [];
    private vectors: number[][] = [];

    // Добавляем конструктор, который может принимать размерность (игнорируется)
    constructor(_dimension?: number) {}

    add(item: IndexedItem, vector: number[]): void {
        this.items.push(item);
        this.vectors.push(vector);
    }

    search(queryVector: number[], topK: number): SearchResult[] {
        const scores: { idx: number; sim: number }[] = [];
        for (let i = 0; i < this.vectors.length; i++) {
            const sim = this.cosineSimilarity(queryVector, this.vectors[i]);
            scores.push({ idx: i, sim });
        }
        scores.sort((a, b) => b.sim - a.sim);
        return scores.slice(0, topK).map(s => ({
            item: this.items[s.idx],
            similarity: s.sim
        }));
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        if (magA === 0 || magB === 0) return 0;
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    async save(path: string): Promise<void> {
        const fs = await import('fs/promises');
        const data = { items: this.items, vectors: this.vectors };
        await fs.writeFile(path + '.linear.json', JSON.stringify(data));
    }

    async load(path: string): Promise<void> {
        const fs = await import('fs/promises');
        try {
            const raw = await fs.readFile(path + '.linear.json', 'utf-8');
            const data = JSON.parse(raw);
            this.items = data.items;
            this.vectors = data.vectors;
        } catch (err) {
            console.warn('No saved linear index found, starting empty');
        }
    }

    clear(): void {
        this.items = [];
        this.vectors = [];
    }

    size(): number {
        return this.items.length;
    }
}

export const EadaVectorIndex = LinearIndex;