import { IndexedItem, SearchResult } from './types.js';

let eadaIndex: any = null;
let useEada = true;

function getEadaIndex() {
    if (!eadaIndex && useEada) {
        try {
            const eada = require('eada-cpu');
            eadaIndex = eada.Index || eada.default?.Index || eada;
            if (!eadaIndex) throw new Error('Cannot find Index in eada-cpu');
            console.log('✅ Using eada-cpu HNSW index');
        } catch (err) {
            console.warn('eada-cpu not available, falling back to in-memory linear search');
            useEada = false;
            eadaIndex = null;
        }
    }
    return eadaIndex;
}

export interface IVectorIndex {
    add(item: IndexedItem, vector: number[]): void;
    search(queryVector: number[], topK: number): SearchResult[];
    save(path: string): Promise<void>;
    load(path: string): Promise<void>;
    clear(): void;
    size(): number;
}

// Линейный индекс (in-memory, косинусное расстояние)
class LinearIndex {
    private items: IndexedItem[] = [];
    private vectors: number[][] = [];

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

    clear(): void {
        this.items = [];
        this.vectors = [];
    }

    size(): number {
        return this.items.length;
    }

    // Для сохранения/загрузки
    getData() {
        return { items: this.items, vectors: this.vectors };
    }
    setData(data: { items: IndexedItem[]; vectors: number[][] }) {
        this.items = data.items;
        this.vectors = data.vectors;
    }
}

export class EadaVectorIndex implements IVectorIndex {
    private hnswIndex: any;
    private items: IndexedItem[] = [];
    private dimension: number;
    private linearIndex: LinearIndex | null = null;

    constructor(dimension: number = 384) {
        this.dimension = dimension;
        const IndexClass = getEadaIndex();
        if (IndexClass && useEada) {
            this.hnswIndex = new IndexClass('HNSW', dimension);
            this.linearIndex = null;
        } else {
            this.linearIndex = new LinearIndex();
            this.hnswIndex = null;
        }
    }

    add(item: IndexedItem, vector: number[]): void {
        if (this.hnswIndex) {
            this.hnswIndex.add(vector);
            this.items.push(item);
        } else if (this.linearIndex) {
            this.linearIndex.add(item, vector);
        }
    }

    search(queryVector: number[], topK: number): SearchResult[] {
        if (this.hnswIndex) {
            const results = this.hnswIndex.search(queryVector, topK);
            return results.map((res: { distance: number; label: number }) => ({
                item: this.items[res.label],
                similarity: 1 - res.distance
            }));
        } else if (this.linearIndex) {
            return this.linearIndex.search(queryVector, topK);
        }
        return [];
    }

    async save(path: string): Promise<void> {
        const fs = await import('fs/promises');
        if (this.hnswIndex) {
            this.hnswIndex.save(path);
            const metaPath = path + '.meta.json';
            await fs.writeFile(metaPath, JSON.stringify(this.items, (key, value) => {
                if (value instanceof Float32Array) return Array.from(value);
                return value;
            }));
        } else if (this.linearIndex) {
            const data = (this.linearIndex as any).getData();
            await fs.writeFile(path + '.linear.json', JSON.stringify(data));
        }
    }

    async load(path: string): Promise<void> {
        const fs = await import('fs/promises');
        if (this.hnswIndex) {
            this.hnswIndex.load(path);
            const metaPath = path + '.meta.json';
            try {
                const data = await fs.readFile(metaPath, 'utf-8');
                const parsed = JSON.parse(data);
                this.items = parsed.map((item: any) => {
                    if (item.embedding) item.embedding = new Float32Array(item.embedding);
                    return item;
                });
            } catch (err) {
                console.warn('No metadata found for HNSW index, starting empty');
                this.items = [];
            }
        } else if (this.linearIndex) {
            const linearPath = path + '.linear.json';
            try {
                const data = await fs.readFile(linearPath, 'utf-8');
                const parsed = JSON.parse(data);
                (this.linearIndex as any).setData(parsed);
            } catch (err) {
                console.warn('No linear index data found, starting empty');
            }
        }
    }

    clear(): void {
        if (this.hnswIndex) {
            const IndexClass = getEadaIndex();
            if (IndexClass) this.hnswIndex = new IndexClass('HNSW', this.dimension);
            this.items = [];
        } else if (this.linearIndex) {
            this.linearIndex.clear();
        }
    }

    size(): number {
        if (this.hnswIndex) return this.items.length;
        if (this.linearIndex) return this.linearIndex.size();
        return 0;
    }
}