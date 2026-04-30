import fs from 'fs';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class ContextManager {
    private client: DeepSeekClient;
    private statsFile: string;
    private maxChars: number;
    private totalChars: number = 0;

    constructor(client: DeepSeekClient) {
        this.client = client;
        this.statsFile = process.env.DEEPSEEK_STATS_FILE || './context_stats.json';
        this.maxChars = parseInt(process.env.DEEPSEEK_MAX_CONTEXT_CHARS || '2400000', 10);
        this.loadStats();
    }

    private loadStats(): void {
        try {
            if (fs.existsSync(this.statsFile)) {
                const data = JSON.parse(fs.readFileSync(this.statsFile, 'utf-8'));
                this.totalChars = data.totalChars || 0;
                console.log(`📊 Loaded context stats: ${this.totalChars} chars`);
            }
        } catch (e) { console.warn('Failed to load context stats:', e); }
    }

    private saveStats(): void {
        try {
            fs.writeFileSync(this.statsFile, JSON.stringify({ totalChars: this.totalChars }, null, 2));
        } catch (e) { console.warn('Failed to save context stats:', e); }
    }

    async updateStats(addedChars: number): Promise<void> {
        this.totalChars += addedChars;
        this.saveStats();
        const percent = Math.round(this.totalChars / this.maxChars * 100);
        console.log(`📏 Context size: ${this.totalChars} / ${this.maxChars} chars (${percent}%) [+${addedChars}]`);
    }

    async canUploadFile(fileSizeChars: number): Promise<boolean> {
        return (this.totalChars + fileSizeChars) <= this.maxChars;
    }

    async getStats(): Promise<{ totalChars: number; maxChars: number; percent: number }> {
        return {
            totalChars: this.totalChars,
            maxChars: this.maxChars,
            percent: Math.round(this.totalChars / this.maxChars * 100)
        };
    }

    async resetContext(): Promise<void> {
        this.totalChars = 0;
        this.saveStats();
        console.log(`🔄 Context reset, new size: 0 chars`);
    }
}