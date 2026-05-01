// src/context/ContextManager.ts
import fs from 'fs';
import path from 'path';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class ContextManager {
    private client: DeepSeekClient;
    private statsFile: string;
    private snapshotFile: string;
    private maxChars: number;
    private totalChars: number = 0;
    private lastSnapshot: string = '';
    private lastSnapshotChars: number = 0;
    private lastSnapshotPercent: number = 0;

    constructor(client: DeepSeekClient) {
        this.client = client;
        this.statsFile = process.env.DEEPSEEK_STATS_FILE || './context_stats.json';
        this.snapshotFile = process.env.DEEPSEEK_SNAPSHOT_FILE || './context_snapshot.json';
        this.maxChars = parseInt(process.env.DEEPSEEK_MAX_CONTEXT_CHARS || '2400000', 10);
        this.loadStats();
        this.loadSnapshot();
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

    private loadSnapshot(): void {
        try {
            if (fs.existsSync(this.snapshotFile)) {
                const data = JSON.parse(fs.readFileSync(this.snapshotFile, 'utf-8'));
                this.lastSnapshot = data.snapshot || '';
                this.lastSnapshotChars = this.lastSnapshot.length;
                this.lastSnapshotPercent = data.percent || 0;
                console.log(`📸 Loaded snapshot: ${this.lastSnapshotChars} chars (created at ${this.lastSnapshotPercent}%)`);
            }
        } catch (e) { console.warn('Failed to load snapshot:', e); }
    }

    private saveSnapshot(snapshot: string, percent: number): void {
        try {
            fs.writeFileSync(this.snapshotFile, JSON.stringify({ snapshot, percent, timestamp: Date.now() }, null, 2));
            this.lastSnapshot = snapshot;
            this.lastSnapshotChars = snapshot.length;
            this.lastSnapshotPercent = percent;
            console.log(`💾 Snapshot saved (${snapshot.length} chars) at ${percent}%`);
        } catch (e) { console.warn('Failed to save snapshot:', e); }
    }

    async updateStats(addedChars: number): Promise<void> {
        this.totalChars += addedChars;
        this.saveStats();
        const percent = Math.round(this.totalChars / this.maxChars * 100);
        console.log(`📏 Context size: ${this.totalChars} / ${this.maxChars} chars (${percent}%) [+${addedChars}]`);
    }

    async checkAndCreateSnapshot(): Promise<boolean> {
        // Временно отключено – будет реализовано позже
        return false;
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

    async resetContext(snapshot?: string): Promise<void> {
        if (snapshot) {
            this.totalChars = snapshot.length;
            this.lastSnapshot = snapshot;
            this.lastSnapshotChars = snapshot.length;
        } else {
            this.totalChars = 0;
            this.lastSnapshot = '';
            this.lastSnapshotChars = 0;
            this.lastSnapshotPercent = 0;
        }
        this.saveStats();
        console.log(`🔄 Context reset, new size: ${this.totalChars} chars`);
    }

    // Полная очистка всех данных контекста (удаление файлов)
    async clearAllContextData(): Promise<void> {
        try {
            if (fs.existsSync(this.statsFile)) fs.unlinkSync(this.statsFile);
            if (fs.existsSync(this.snapshotFile)) fs.unlinkSync(this.snapshotFile);
            this.totalChars = 0;
            this.lastSnapshot = '';
            this.lastSnapshotChars = 0;
            this.lastSnapshotPercent = 0;
            console.log('🧹 Context data files deleted and memory reset');
        } catch (e) { console.warn('Failed to clear context data:', e); }
    }
}