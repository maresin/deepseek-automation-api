const fs = require('fs').promises;
const path = require('path');

let embedder = null;

async function getEmbedder() {
    if (!embedder) {
        console.log('🔄 Loading embedding model...');
        const { pipeline } = await import('@xenova/transformers');
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('✅ Embedding model ready');
    }
    return embedder;
}

function cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

class RagManager {
    constructor(sessionId, dataDir = './rag_data') {
        this.sessionId = sessionId;
        this.dataDir = dataDir;
        this.messages = [];
        this.fileChunks = [];
        this.init();
    }

    async init() {
        await this.loadFromFile();
    }

    getFilePath() {
        return path.join(process.cwd(), this.dataDir, `${this.sessionId}.json`);
    }

    async saveToFile() {
        const filePath = this.getFilePath();
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const dataToSave = {
            messages: this.messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                embedding: msg.embedding ? Array.from(msg.embedding) : null
            })),
            fileChunks: this.fileChunks.map(chunk => ({
                file: chunk.file,
                chunkIndex: chunk.chunkIndex,
                content: chunk.content,
                timestamp: chunk.timestamp,
                embedding: Array.from(chunk.embedding)
            }))
        };
        await fs.writeFile(filePath, JSON.stringify(dataToSave, null, 2));
        console.log(`💾 Saved ${this.messages.length} messages and ${this.fileChunks.length} chunks to ${filePath}`);
    }

    async loadFromFile() {
        const filePath = this.getFilePath();
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const loaded = JSON.parse(data);
            this.messages = loaded.messages.map(msg => ({
                ...msg,
                embedding: msg.embedding ? new Float32Array(msg.embedding) : null
            }));
            this.fileChunks = loaded.fileChunks.map(chunk => ({
                ...chunk,
                embedding: new Float32Array(chunk.embedding)
            }));
            console.log(`📂 Loaded ${this.messages.length} messages and ${this.fileChunks.length} chunks from ${filePath}`);
        } catch (err) {
            console.log(`No existing data for session ${this.sessionId}, starting fresh`);
        }
    }

    async addMessage(role, content) {
        const message = { role, content, timestamp: Date.now() };
        if (role === 'user') {
            const embedder = await getEmbedder();
            const result = await embedder(content, { pooling: 'mean', normalize: true });
            message.embedding = result.data;
        }
        this.messages.push(message);
        await this.saveToFile();
    }

    async addFileChunk(fileName, chunkIndex, content) {
        const embedder = await getEmbedder();
        const result = await embedder(content, { pooling: 'mean', normalize: true });
        this.fileChunks.push({
            file: fileName,
            chunkIndex,
            content,
            timestamp: Date.now(),
            embedding: result.data
        });
        await this.saveToFile();
    }

    async search(query, topK = 5) {
        const embedder = await getEmbedder();
        const queryResult = await embedder(query, { pooling: 'mean', normalize: true });
        const queryVec = queryResult.data;

        const scored = [];

        for (const msg of this.messages) {
            if (!msg.embedding) continue;
            const sim = cosineSimilarity(queryVec, msg.embedding);
            scored.push({
                type: 'message',
                role: msg.role,
                content: msg.content,
                similarity: sim
            });
        }

        for (const chunk of this.fileChunks) {
            const sim = cosineSimilarity(queryVec, chunk.embedding);
            scored.push({
                type: 'file',
                file: chunk.file,
                content: chunk.content,
                similarity: sim
            });
        }

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topK);
    }
}

module.exports = { RagManager };