import fs from 'fs';
import path from 'path';
import { DeepSeekClient } from '../DeepSeekClient.js';

export class ContextManager {
    private client: DeepSeekClient;
    private statsFile: string;
    private snapshotFile: string;           // метаданные снимка (текст, процент)
    private snapshotFilePath: string | null; // путь к актуальному файлу снимка
    private maxChars: number;
    private snapshotReserveRatio: number;
    private totalChars: number = 0;
    private lastSnapshot: string = '';
    private lastSnapshotChars: number = 0;
    private lastSnapshotPercent: number = 0;
    private snapshotCreatedForSession: boolean = false; // флаг для текущей сессии

    constructor(client: DeepSeekClient) {
        this.client = client;
        this.statsFile = process.env.DEEPSEEK_STATS_FILE || './context_stats.json';
        this.snapshotFile = process.env.DEEPSEEK_SNAPSHOT_FILE || './context_snapshot.json';
        this.maxChars = parseInt(process.env.DEEPSEEK_MAX_CONTEXT_CHARS || '2400000', 10);
        this.snapshotReserveRatio = 0.1;
        this.snapshotFilePath = null;
        this.loadStats();
        this.loadSnapshot();
        this.cleanupOldSnapshots(); // удаляем все старые временные файлы снимков
    }

    private cleanupOldSnapshots(): void {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) return;
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
            if (file.startsWith('session_snapshot_') || file.startsWith('snapshot_')) {
                try {
                    fs.unlinkSync(path.join(uploadsDir, file));
                    console.log(`🧹 Removed old snapshot file: ${file}`);
                } catch (e) {}
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

    private saveSnapshotToFile(snapshot: string, percent: number): void {
        try {
            fs.writeFileSync(this.snapshotFile, JSON.stringify({ snapshot, percent, timestamp: Date.now() }, null, 2));
            this.lastSnapshot = snapshot;
            this.lastSnapshotChars = snapshot.length;
            this.lastSnapshotPercent = percent;
            console.log(`💾 Snapshot metadata saved to ${this.snapshotFile} (${snapshot.length} chars) at ${percent}%`);
        } catch (e) { console.warn('Failed to save snapshot metadata:', e); }
    }

    async updateStats(addedChars: number): Promise<void> {
        this.totalChars += addedChars;
        this.saveStats();
        const percent = Math.round(this.totalChars / this.maxChars * 100);
        console.log(`📏 Context size: ${this.totalChars} / ${this.maxChars} chars (${percent}%) [+${addedChars}]`);

        // Создаём снимок только один раз за сессию при первом достижении 70%
        if (percent >= 70 && !this.snapshotCreatedForSession) {
            console.log(`📸 Context reached ${percent}%, creating snapshot for this session...`);
            await this.createSessionSnapshot();
            this.snapshotCreatedForSession = true;
            this.saveSnapshotToFile(this.lastSnapshot, percent);
        }
    }

    private async createSessionSnapshot(): Promise<void> {
        const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
        if (!fs.existsSync(snapshotPromptPath)) {
            console.warn('Snapshot prompt not found, skipping snapshot creation');
            return;
        }
        const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
        console.log('📸 Creating session snapshot...');
        
        let snapshotContent = '';
        let attempt = 0;
        const maxAttempts = 2;
        
        while (attempt < maxAttempts && !snapshotContent) {
            const wasDeepThink = await this.client.featureToggles.isDeepThinkEnabled();
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(true);
            
            try {
                snapshotContent = await this.client.executePipeline({ text: snapshotPrompt, skipStatsUpdate: true });
            } catch (err) {
                console.warn(`Snapshot attempt ${attempt + 1} failed:`, err);
            }
            
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(false);
            
            if (!snapshotContent || snapshotContent.trim().length === 0) {
                console.log(`   Empty response, attempt ${attempt + 1}/${maxAttempts}, retrying...`);
                await this.client.page!.waitForTimeout(3000);
                attempt++;
            } else {
                break;
            }
        }
        
        // Если всё равно пусто – пробуем альтернативные методы извлечения
        if (!snapshotContent || snapshotContent.trim().length === 0) {
            console.log('   Falling back to global copy button...');
            snapshotContent = await this.client.responseExtractor.getResponseViaCopyButton();
        }
        if (!snapshotContent || snapshotContent.trim().length === 0) {
            console.log('   Falling back to markdown extraction...');
            snapshotContent = await this.client.responseExtractor.getResponseViaMarkdown();
        }
        
        if (!snapshotContent || snapshotContent.trim().length === 0) {
            console.error('Failed to create snapshot: empty response after all fallbacks');
            return;
        }
        
        let snapshot = snapshotContent;
        const maxSnapshotChars = Math.floor(this.maxChars * this.snapshotReserveRatio);
        if (snapshot.length > maxSnapshotChars) {
            snapshot = snapshot.substring(0, maxSnapshotChars);
            console.warn(`Snapshot truncated to ${maxSnapshotChars} chars`);
        }
        
        // Сохраняем в файл (уникальное имя для этой сессии)
        this.snapshotFilePath = path.join(process.cwd(), 'uploads', `session_snapshot_${Date.now()}.txt`);
        fs.writeFileSync(this.snapshotFilePath, snapshot, 'utf-8');
        this.lastSnapshot = snapshot;
        console.log(`💾 Session snapshot saved to file: ${this.snapshotFilePath} (${snapshot.length} chars)`);
    }

    // Возвращает путь к актуальному файлу снимка (если есть)
    public getSnapshotFilePath(): string | null {
        if (this.snapshotFilePath && fs.existsSync(this.snapshotFilePath)) {
            return this.snapshotFilePath;
        }
        // Если есть сохранённый текст, но файл потерян – восстанавливаем
        if (this.lastSnapshot && this.lastSnapshot.length > 0) {
            this.snapshotFilePath = path.join(process.cwd(), 'uploads', `session_snapshot_${Date.now()}.txt`);
            fs.writeFileSync(this.snapshotFilePath, this.lastSnapshot, 'utf-8');
            return this.snapshotFilePath;
        }
        return null;
    }

    // Удаляет файл снимка (после успешного перехода)
    public async deleteSnapshotFile(): Promise<void> {
        if (this.snapshotFilePath && fs.existsSync(this.snapshotFilePath)) {
            try {
                fs.unlinkSync(this.snapshotFilePath);
                console.log(`🧹 Deleted snapshot file: ${this.snapshotFilePath}`);
                this.snapshotFilePath = null;
            } catch (e) {
                console.warn(`Failed to delete snapshot file: ${e}`);
            }
        }
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
            if (fs.existsSync(this.snapshotFile)) fs.unlinkSync(this.snapshotFile);
            this.totalChars = 0;
            this.lastSnapshot = '';
            this.lastSnapshotChars = 0;
            this.lastSnapshotPercent = 0;
            this.snapshotCreatedForSession = false;
            await this.deleteSnapshotFile();
            console.log('🧹 Context data files deleted and memory reset');
        } catch (e) { console.warn('Failed to clear context data:', e); }
    }

    async getSnapshot(): Promise<string> {
        if (!this.lastSnapshot) this.loadSnapshot();
        return this.lastSnapshot;
    }

    // Метод для принудительного создания снимка (может быть вызван внешне)
    public async forceSnapshot(): Promise<void> {
        await this.createSessionSnapshot();
    }
}