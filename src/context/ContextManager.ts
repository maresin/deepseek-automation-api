// src/context/ContextManager.ts
/**
 * @file src/context/ContextManager.ts
 * Manages conversation context size, snapshots, and language analysis.
 *
 * Snapshot model
 * --------------
 * There is exactly one snapshot file, always named snapshot.txt, always in
 * uploads/. Two boolean flags record whether the file has been created
 * (snapshot70Done) and refreshed at the 90% threshold (snapshot90Done).
 * The flags are persisted in chat_state.json alongside the rest of the
 * session state.
 *
 * At 70% the snapshot is created. At 90% it is overwritten with fresher
 * content. After a successful context transition the file is deleted and
 * both flags are reset.
 */

import fs from 'fs';
import path from 'path';
import { DeepSeekClient } from '../DeepSeekClient.js';
import { loadPrompt } from '../utils/prompts.js';
import { getUploadsDir } from '../utils/paths.js';

export class ContextManager {
    private client: DeepSeekClient;
    private maxChars: number;
    private snapshotReserveRatio: number;
    public totalChars: number = 0;

    /**
     * Snapshot state flags. Persisted in chat_state.json via
     * DeepSeekClient.saveChatState().
     */
    public snapshot70Done: boolean = false;
    public snapshot90Done: boolean = false;

    /** Guards against concurrent snapshot creation. */
    private isCreatingSnapshot: boolean = false;

    /** The single snapshot file. Fixed name, fixed location. */
    private readonly SNAPSHOT_FILE_NAME = 'snapshot.txt';

    private languageMix: { latin: number; cyrillic: number; cjk: number; other: number } = {
        latin: 0, cyrillic: 0, cjk: 0, other: 0,
    };
    private userTextBuffer: string = '';
    private languageAnalysisDone: boolean = false;
    private readonly MIN_ANALYSIS_CHARS = 500;
    private readonly MAX_ANALYSIS_CHARS = 5000;

    private readonly COEF_LATIN = 3.0;
    private readonly COEF_CYRILLIC = 2.4;
    private readonly COEF_CJK = 1.0;
    private readonly COEF_OTHER = 2.0;

    constructor(client: DeepSeekClient) {
        this.client = client;
        this.maxChars = parseInt(process.env.DEEPSEEK_MAX_CONTEXT_CHARS || '2400000', 10);
        this.snapshotReserveRatio = 0.1;
    }

    // ============================================================
    // LANGUAGE ANALYSIS
    // ============================================================

    analyzeUserMessage(text: string): void {
        if (this.languageAnalysisDone) return;
        if (!text || text.length === 0) return;

        this.userTextBuffer += ' ' + text;

        if (this.userTextBuffer.length >= this.MIN_ANALYSIS_CHARS) {
            const sample = this.userTextBuffer.slice(0, this.MAX_ANALYSIS_CHARS);
            this.computeLanguageMix(sample);
            this.languageAnalysisDone = true;
            const coef = this.getLanguageCoefficient();
            console.log(`🌍 Language mix: ${JSON.stringify(this.languageMix)}, coef=${coef.toFixed(2)} symbols/token`);
        }
    }

    private computeLanguageMix(sample: string): void {
        let latin = 0, cyrillic = 0, cjk = 0, other = 0;
        for (let i = 0; i < sample.length; i++) {
            const c = sample.charCodeAt(i);
            if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) continue;
            if (c >= 0x21 && c <= 0x2F) continue;
            if (c >= 0x3A && c <= 0x40) continue;
            if (c >= 0x5B && c <= 0x60) continue;
            if (c >= 0x7B && c <= 0x7E) continue;

            if ((c >= 0x4E00 && c <= 0x9FFF) ||
                (c >= 0x3040 && c <= 0x30FF) ||
                (c >= 0xAC00 && c <= 0xD7AF)) {
                cjk++;
            } else if (c >= 0x0400 && c <= 0x04FF) {
                cyrillic++;
            } else if ((c >= 0x0041 && c <= 0x007A) || (c >= 0x00C0 && c <= 0x024F)) {
                latin++;
            } else if (c >= 0x21) {
                other++;
            }
        }
        const total = latin + cyrillic + cjk + other;
        if (total === 0) return;
        this.languageMix = {
            latin: latin / total,
            cyrillic: cyrillic / total,
            cjk: cjk / total,
            other: other / total,
        };
    }

    getLanguageCoefficient(): number {
        if (!this.languageAnalysisDone) return 2.5;
        const w = this.languageMix;
        return (
            w.latin * this.COEF_LATIN +
            w.cyrillic * this.COEF_CYRILLIC +
            w.cjk * this.COEF_CJK +
            w.other * this.COEF_OTHER
        );
    }

    getDynamicMaxChars(): number {
        if (!this.languageAnalysisDone) return this.maxChars;
        const coef = this.getLanguageCoefficient();
        return Math.floor(1_000_000 * coef);
    }

    getContextStatus(deepseekLengthLimit: { detected: boolean; percent: number | null } = { detected: false, percent: null }): {
        chars_used: number;
        chars_limit: number;
        percent_used: number;
        language_mix: { latin: number; cyrillic: number; cjk: number; other: number };
        language_coefficient: number;
        deepseek_length_limit: { detected: boolean; readable_percent: number | null };
        warning: string | null;
        recommendation: string | null;
    } {
        const limit = this.getDynamicMaxChars();
        const used = this.totalChars;
        const percent = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;

        let warning: string | null = null;
        let recommendation: string | null = null;

        if (deepseekLengthLimit.detected) {
            warning = 'context_limit_reached';
            recommendation = 'transition_to_new_chat';
        } else if (percent >= 90) {
            warning = 'context_near_limit';
            recommendation = 'transition_to_new_chat';
        } else if (percent >= 70) {
            warning = 'context_above_70';
            recommendation = 'monitor';
        }

        return {
            chars_used: used,
            chars_limit: limit,
            percent_used: percent,
            language_mix: this.languageMix,
            language_coefficient: Math.round(this.getLanguageCoefficient() * 100) / 100,
            deepseek_length_limit: {
                detected: deepseekLengthLimit.detected,
                readable_percent: deepseekLengthLimit.percent,
            },
            warning,
            recommendation,
        };
    }

    resetLanguageAnalysis(): void {
        this.languageMix = { latin: 0, cyrillic: 0, cjk: 0, other: 0 };
        this.userTextBuffer = '';
        this.languageAnalysisDone = false;
    }

    // ============================================================
    // CONTEXT SIZE TRACKING
    // ============================================================

    /**
     * Add characters to the current context size.
     * Only updates the counter; does NOT create snapshots.
     */
    async addChars(addedChars: number, multiplier: number = 1): Promise<void> {
        const effectiveChars = Math.floor(addedChars * multiplier);
        this.totalChars += effectiveChars;

        const maxChars = this.getDynamicMaxChars();
        const percent = Math.round(this.totalChars / maxChars * 100);
        console.log(`📏 Context size: ${this.totalChars} / ${maxChars} chars (${percent}%) ` +
            `[+${effectiveChars} (raw ${addedChars} × ${multiplier})]`);

        await this.client.saveChatState();
    }

    /**
     * Check context size and act on thresholds.
     *
     * At 70%: create the snapshot if it does not exist yet.
     * At 90%: overwrite the snapshot with fresher content and flag transition.
     *
     * Both thresholds are only active when ENABLE_SNAPSHOT is true.
     */
    async checkAndSnapshot(): Promise<void> {
        const enableSnapshot = process.env.ENABLE_SNAPSHOT === 'true';
        const enableRag = process.env.ENABLE_RAG === 'true';

        const maxChars = this.getDynamicMaxChars();
        const percent = Math.round(this.totalChars / maxChars * 100);

        if (!enableSnapshot && !enableRag) return;

        if (enableSnapshot && !this.isCreatingSnapshot) {
            if (percent >= 90 && !this.snapshot90Done) {
                console.log(`📸 Context reached ${percent}%, refreshing snapshot...`);
                await this.createTransitionSnapshot();
            } else if (percent >= 70 && !this.snapshot70Done) {
                console.log(`📸 Context reached ${percent}%, creating snapshot...`);
                await this.createSessionSnapshot();
            }
        }

        if (percent >= 90) {
            this.client.needTransition = true;
            console.log(`⚠️ Context at ${percent}% – transition flagged for next request`);
        }
    }

    /**
     * Create the snapshot at the 70% threshold.
     * Does nothing if snapshot70Done is already true.
     */
    private async createSessionSnapshot(): Promise<void> {
        if (this.snapshot70Done) {
            console.log('ℹ️ Snapshot already created, skipping');
            return;
        }

        this.isCreatingSnapshot = true;
        try {
            const snapshotPrompt = loadPrompt('snapshot_prompt.txt', { required: true });

            console.log('📸 Creating session snapshot...');

            const wasDeepThink = await this.client.featureToggles.isDeepThinkEnabled();
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(true);

            const snapshotContent = await this.client.executePipeline({
                text: snapshotPrompt,
                skipStatsUpdate: true,
            });

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

            const filePath = path.join(getUploadsDir(), this.SNAPSHOT_FILE_NAME);
            fs.writeFileSync(filePath, snapshot, 'utf-8');

            this.snapshot70Done = true;
            console.log(`💾 Snapshot saved to ${filePath} (${snapshot.length} chars)`);

            await this.client.saveChatState();
        } finally {
            this.isCreatingSnapshot = false;
        }
    }

    /**
     * Create or overwrite the transition snapshot at the 90% threshold.
     * Overwrites any existing snapshot — the content is always fresher.
     */
    public async createTransitionSnapshot(): Promise<string | null> {
        this.isCreatingSnapshot = true;
        try {
            const snapshotPrompt = loadPrompt('snapshot_prompt.txt', { required: true });

            console.log('📸 Creating transition snapshot (90-95%)...');

            const wasDeepThink = await this.client.featureToggles.isDeepThinkEnabled();
            if (!wasDeepThink) await this.client.featureToggles.setDeepThink(true);

            const snapshotContent = await this.client.executePipeline({
                text: snapshotPrompt,
                skipStatsUpdate: true,
            });

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

            const filePath = path.join(getUploadsDir(), this.SNAPSHOT_FILE_NAME);
            fs.writeFileSync(filePath, snapshot, 'utf-8');

            this.snapshot70Done = true;
            this.snapshot90Done = true;
            console.log(`💾 Transition snapshot saved to ${filePath} (${snapshot.length} chars)`);

            await this.client.saveChatState();
            return filePath;
        } finally {
            this.isCreatingSnapshot = false;
        }
    }

    /**
     * Absolute path to the snapshot file, or null if it does not exist.
     */
    public getSnapshotPath(): string | null {
        const filePath = path.join(getUploadsDir(), this.SNAPSHOT_FILE_NAME);
        return fs.existsSync(filePath) ? filePath : null;
    }

    /**
     * Delete the snapshot file and reset both flags.
     * Called after a successful context transition and on session reset.
     */
    public clearSnapshot(): void {
        const filePath = path.join(getUploadsDir(), this.SNAPSHOT_FILE_NAME);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log('🧹 Snapshot file cleared');
            } catch (err) {
                console.warn(`⚠️ Could not delete snapshot: ${(err as Error).message}`);
            }
        }
        this.snapshot70Done = false;
        this.snapshot90Done = false;
    }

    async getStats(): Promise<{ totalChars: number; maxChars: number; percent: number }> {
        const maxChars = this.getDynamicMaxChars();
        return {
            totalChars: this.totalChars,
            maxChars,
            percent: Math.round(this.totalChars / maxChars * 100),
        };
    }

    async resetContext(snapshot?: string): Promise<void> {
        this.totalChars = snapshot ? snapshot.length : 0;
        this.snapshot70Done = false;
        this.snapshot90Done = false;
        console.log(`🔄 Context reset, new size: ${this.totalChars} chars`);
    }

    async clearAllContextData(): Promise<void> {
        try {
            this.clearSnapshot();
            this.totalChars = 0;
            this.resetLanguageAnalysis();
            console.log('🧹 All context data cleared');
        } catch (e) {
            console.warn('Failed to clear context data:', e);
        }
    }

    /**
     * Read the current snapshot file content, or an empty string if absent.
     * Kept for callers that previously read lastSnapshot from memory.
     */
    async getSnapshot(): Promise<string> {
        const filePath = this.getSnapshotPath();
        if (!filePath) return '';
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch {
            return '';
        }
    }
}