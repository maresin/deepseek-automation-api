import { IndexedItem, SearchResult } from './types.js';

let eadaIndex: any = null;

function getEadaIndex() {
    if (!eadaIndex) {
        try {
            const eada = require('eada-cpu');
            eadaIndex = eada.Index || eada.default?.Index || eada;
            if (!eadaIndex) throw new Error('Cannot find Index in eada-cpu');
        } catch (err) {
            console.warn('eada-cpu not available, falling back to in-memory stub');
            eadaIndex = class {
                constructor(public type: string, public dim: number) {}
                add() {}
                search() { return []; }
                save() {}
                load() {}
            };
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

export class EadaVectorIndex implements IVectorIndex {
    private index: any;
    private items: IndexedItem[] = [];
    private dimension: number;

    constructor(dimension: number = 384) {
        this.dimension = dimension;
        const IndexClass = getEadaIndex();
        this.index = new IndexClass('HNSW', dimension);
    }

    add(item: IndexedItem, vector: number[]): void {
        this.index.add(vector);
        this.items.push(item);
    }

    search(queryVector: number[], topK: number): SearchResult[] {
        const results = this.index.search(queryVector, topK);
        return results.map((res: { distance: number; label: number }) => ({
            item: this.items[res.label],
            similarity: 1 - res.distance
        }));
    }

    async save(path: string): Promise<void> {
        this.index.save(path);
        const fs = await import('fs/promises');
        const metaPath = path + '.meta.json';
        await fs.writeFile(metaPath, JSON.stringify(this.items, (key, value) => {
            if (value instanceof Float32Array) return Array.from(value);
            return value;
        }));
    }

    async load(path: string): Promise<void> {
        this.index.load(path);
        const fs = await import('fs/promises');
        const metaPath = path + '.meta.json';
        try {
            const data = await fs.readFile(metaPath, 'utf-8');
            const parsed = JSON.parse(data);
            this.items = parsed.map((item: any) => {
                if (item.embedding) item.embedding = new Float32Array(item.embedding);
                return item;
            });
        } catch (err) {
            console.warn('No metadata found for index, starting empty');
            this.items = [];
        }
    }

    clear(): void {
        const IndexClass = getEadaIndex();
        this.index = new IndexClass('HNSW', this.dimension);
        this.items = [];
    }

    size(): number {
        return this.items.length;
    }
}