import { Message, SearchResult } from './types.js';

// Динамический импорт для обхода проблем с типами eada-cpu
let Index: any;
try {
    const eada = require('eada-cpu');
    Index = eada.Index || eada.default?.Index || eada;
} catch (err) {
    console.warn('eada-cpu not available, falling back to in-memory stub');
    Index = class {
        constructor(public type: string, public dim: number) {}
        add() {}
        search() { return []; }
        save() {}
        load() {}
    };
}

export interface IVectorIndex {
    add(message: Message, vector: number[]): void;
    search(queryVector: number[], topK: number): SearchResult[];
    save(path: string): Promise<void>;
    load(path: string): Promise<void>;
    clear(): void;
    size(): number;
}

export class EadaVectorIndex implements IVectorIndex {
    private index: any;
    private messages: Message[] = [];
    private dimension: number;

    constructor(dimension: number = 384) {
        this.dimension = dimension;
        this.index = new Index('HNSW', dimension);
    }

    add(message: Message, vector: number[]): void {
        this.index.add(vector);
        this.messages.push(message);
    }

    search(queryVector: number[], topK: number): SearchResult[] {
        const results: Array<{ distance: number; label: number }> = this.index.search(queryVector, topK);
        return results.map((res) => ({
            message: this.messages[res.label],
            similarity: 1 - res.distance
        }));
    }

    async save(path: string): Promise<void> {
        this.index.save(path);
        const fs = await import('fs/promises');
        const metaPath = path + '.meta.json';
        await fs.writeFile(metaPath, JSON.stringify(this.messages, null, 2));
    }

    async load(path: string): Promise<void> {
        this.index.load(path);
        const fs = await import('fs/promises');
        const metaPath = path + '.meta.json';
        try {
            const data = await fs.readFile(metaPath, 'utf-8');
            this.messages = JSON.parse(data);
        } catch (err) {
            console.warn('No metadata found for index, starting empty');
            this.messages = [];
        }
    }

    clear(): void {
        this.index = new Index('HNSW', this.dimension);
        this.messages = [];
    }

    size(): number {
        return this.messages.length;
    }
}