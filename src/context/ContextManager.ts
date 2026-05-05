// src/context/ContextManager.ts
import fs from 'fs';
import path from 'path';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class ContextManager {
    private client: DeepSeekClient;
    private statsFile: string;
    private snapshotMetadataFile: string;
    private maxChars: number;
    private snapshotReserveRatio: number;
    private totalChars: number = 0;
    private lastSnapshot: string = '';
    private lastSnapshotChars: number = 0;
    private lastSnapshotPercent: number = 0;
    private snapshotCreatedForSession: boolean = false;
    private isCreatingSnapshot: boolean = false;
    private snapshots: Map<string, { path: string; timestamp: number; size: number }> = new Map();
    private readonly SNAPSHOT_70_KEY = 'snapshot_70';
    private readonly SNAPSHOT_90_KEY = 'snapshot_90';

    constructor(client: DeepSeekClient) {
        this.client = client;
        this.statsFile = process.env.DEEPSEEK_STATS_FILE || './context_stats.json';
        this.snapshotMetadataFile = process.env.DEEPSEEK_SNAPSHOT_FILE || './context_snapshot.json';
        this.maxChars = parseInt(process.env.DEEPSEEK_MAX_CONTEXT_CHARS || '2400000', 10);
        this.snapshotReserveRatio = 0.1;
        this.loadStats();
        this.loadSnapshotMetadata();
        this.loadSnapshotsFromDisk();
    }

    private loadSnapshotsFromDisk(): void {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) return;
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
            if (file.startsWith('snapshot_70_')) {
                const filePath = path.join(uploadsDir, file);
                const stats = fs.statSync(filePath);
                this.snapshots.set(this.SNAPSHOT_70_KEY, {
                    path: filePath,
                    timestamp: stats.mtimeMs,
                    size: stats.size
                });
            } else if (file.startsWith('snapshot_90_')) {
                const filePath = path.join(uploadsDir, file);
                const stats = fs.statSync(filePath);
                this.snapshots.set(this.SNAPSHOT_90_KEY, {
                    path: filePath,
                    timestamp: stats.mtimeMs,
                    size: stats.size
                });
            }
        }
    }

    private loadStats(): void {
        try {
            if (fs.existsSync(this.statsFile)) {
                const data = JSON.parse(fs.readFileSync(this.statsFile, 'utf-8'));
                this.totalChars = data.totalChars || 0;
                console.log(`📊 Loaded context stats: ${this.totalChars} chars`);
            }
        } catch (e) {}
    }

    private saveStats(): void {
        try {
            fs.writeFileSync(this.statsFile, JSON.stringify({ totalChars: this.totalChars }, null, 2));
        } catch (e) {}
    }

    private loadSnapshotMetadata(): void {
        try {
            if (fs.existsSync(this.snapshotMetadataFile)) {
                const data = JSON.parse(fs.readFileSync(this.snapshotMetadataFile, 'utf-8'));
                this.lastSnapshot = data.snapshot || '';
                this.lastSnapshotChars = this.lastSnapshot.length;
                this.lastSnapshotPercent = data.percent || 0;
            }
        } catch (e) {}
    }

    private saveSnapshotMetadata(snapshot: string, percent: number): void {
        try {
            fs.writeFileSync(this.snapshotMetadataFile, JSON.stringify({ snapshot, percent, timestamp: Date.now() }, null, 2));
            this.lastSnapshot = snapshot;
            this.lastSnapshotChars = snapshot.length;
            this.lastSnapshotPercent = percent;
        } catch (e) {}
    }

    async updateStats(addedChars: number, multiplier: number = 1): Promise<void> {
        const effectiveChars = Math.floor(addedChars * multiplier);
        this.totalChars += effectiveChars;
        this.saveStats();
        const percent = Math.round(this.totalChars / this.maxChars * 100);
        console.log(`📏 Context size: ${this.totalChars} / ${this.maxChars} chars (${percent}%) [+${effectiveChars} (raw ${addedChars} × ${multiplier})]`);

        if (percent >= 70 && !this.snapshotCreatedForSession && !this.isCreatingSnapshot) {
            console.log(`📸 Context reached ${percent}%, creating snapshot for this session...`);
            await this.createSessionSnapshot();
            this.snapshotCreatedForSession = true;
        }

        if (percent >= 90) {
            this.client.needTransition = true;
            console.log(`⚠️ Context at ${percent}% – transition flagged`);
        }
    }

    private async createSessionSnapshot(): Promise<void> {
        if (this.snapshots.has(this.SNAPSHOT_70_KEY)) {
            console.log(`ℹ️ Snapshot 70% already exists, skipping creation`);
            return;
        }

        this.isCreatingSnapshot = true;
        try {
            const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
            if (!fs.existsSync(snapshotPromptPath)) {
                console.warn('Snapshot prompt not found');
                return;
            }
            const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
            console.log('📸 Creating session snapshot...');
            const wasDeepThink = await this.client.featureToggles.isDeepThinkEnabled();
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(true);
            const snapshotContent = await this.client.executePipeline({ text: snapshotPrompt, skipStatsUpdate: false });
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(false);
            if (!snapshotContent || snapshotContent.trim().length === 0) {
                console.error('Failed to create snapshot: empty response');
                return;
            }
            let snapshot = snapshotContent;
            const maxSnapshotChars = Math.floor(this.maxChars * this.snapshotReserveRatio);
            if (snapshot.length > maxSnapshotChars) {
                snapshot = snapshot.substring(0, maxSnapshotChars);
                console.warn(`Snapshot truncated to ${maxSnapshotChars} chars`);
            }
            const filePath = path.join(process.cwd(), 'uploads', `snapshot_70_${Date.now()}.txt`);
            fs.writeFileSync(filePath, snapshot, 'utf-8');
            this.snapshots.set(this.SNAPSHOT_70_KEY, {
                path: filePath,
                timestamp: Date.now(),
                size: snapshot.length
            });
            this.saveSnapshotMetadata(snapshot, 70);
            console.log(`💾 Snapshot 70% saved to ${filePath} (${snapshot.length} chars)`);
        } finally {
            this.isCreatingSnapshot = false;
        }
    }

    public async createTransitionSnapshot(): Promise<string | null> {
        this.isCreatingSnapshot = true;
        try {
            const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
            if (!fs.existsSync(snapshotPromptPath)) {
                console.error('Snapshot prompt not found');
                return null;
            }
            const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
            console.log('📸 Creating transition snapshot (90-95%)...');
            const wasDeepThink = await this.client.featureToggles.isDeepThinkEnabled();
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(true);
            const snapshotContent = await this.client.executePipeline({ text: snapshotPrompt, skipStatsUpdate: false });
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(false);
            if (!snapshotContent || snapshotContent.trim().length === 0) {
                console.error('Failed to create transition snapshot: empty response');
                return null;
            }
            let snapshot = snapshotContent;
            const maxSnapshotChars = Math.floor(this.maxChars * this.snapshotReserveRatio);
            if (snapshot.length > maxSnapshotChars) {
                snapshot = snapshot.substring(0, maxSnapshotChars);
                console.warn(`Snapshot truncated to ${maxSnapshotChars} chars`);
            }
            const filePath = path.join(process.cwd(), 'uploads', `snapshot_90_${Date.now()}.txt`);
            fs.writeFileSync(filePath, snapshot, 'utf-8');
            if (this.snapshots.has(this.SNAPSHOT_90_KEY)) {
                const old = this.snapshots.get(this.SNAPSHOT_90_KEY)!;
                try { if (fs.existsSync(old.path)) fs.unlinkSync(old.path); } catch(e) {}
            }
            this.snapshots.set(this.SNAPSHOT_90_KEY, {
                path: filePath,
                timestamp: Date.now(),
                size: snapshot.length
            });
            this.saveSnapshotMetadata(snapshot, 90);
            console.log(`💾 Transition snapshot (90%) saved to ${filePath} (${snapshot.length} chars)`);
            return filePath;
        } finally {
            this.isCreatingSnapshot = false;
        }
    }

    public getLatestSnapshotPath(): string | null {
        let latest = null;
        let latestTime = 0;
        for (const info of this.snapshots.values()) {
            if (info.timestamp > latestTime) {
                latestTime = info.timestamp;
                latest = info.path;
            }
        }
        return latest;
    }

    public canCreateTransitionSnapshot(additionalChars: number): boolean {
        const newTotal = this.totalChars + additionalChars;
        const newPercent = (newTotal / this.maxChars) * 100;
        return newPercent >= 90 && newPercent <= 95;
    }

    async canUploadFile(fileSizeChars: number): Promise<boolean> {
        return (this.totalChars + fileSizeChars) <= this.maxChars * 0.9;
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
        this.snapshotCreatedForSession = false;
        this.saveStats();
        console.log(`🔄 Context reset, new size: ${this.totalChars} chars`);
    }

    async clearAllContextData(): Promise<void> {
        try {
            if (fs.existsSync(this.statsFile)) fs.unlinkSync(this.statsFile);
            if (fs.existsSync(this.snapshotMetadataFile)) fs.unlinkSync(this.snapshotMetadataFile);
            for (const info of this.snapshots.values()) {
                try { if (fs.existsSync(info.path)) fs.unlinkSync(info.path); } catch(e) {}
            }
            this.snapshots.clear();
            this.totalChars = 0;
            this.lastSnapshot = '';
            this.lastSnapshotChars = 0;
            this.lastSnapshotPercent = 0;
            this.snapshotCreatedForSession = false;
            console.log('🧹 All context data files deleted and memory reset');
        } catch (e) {}
    }

    async getSnapshot(): Promise<string> {
        if (!this.lastSnapshot) this.loadSnapshotMetadata();
        return this.lastSnapshot;
    }
}