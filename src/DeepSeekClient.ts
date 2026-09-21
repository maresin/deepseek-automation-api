// src/DeepSeekClient.ts
/**
 * @file src/DeepSeekClient.ts
 * Main client for interacting with DeepSeek Web via browser automation.
 * Manages browser lifecycle, authentication, message sending, and response handling.
 *
 * Recovery is expressed via three independent flags in .env:
 *   ENABLE_RESTORE   — reopen last chat on startup / on /v1/chat/new restore=true
 *   ENABLE_SNAPSHOT  — snapshot-cycle at 70% / 90%
 *   ENABLE_RAG       — index everything, activate search after 90% transition
 *
 * Two separate state files:
 *   - state.json      : Playwright browser state (cookies, origins).
 *                       Overwritten by server.js / BrowserManager.
 *   - chat_state.json : Chat session state under the "deepseek" key.
 *                       Owned exclusively by this client.
 */

import fs from 'fs';
import path from 'path';
import { BrowserManager } from './browser/BrowserManager.js';
import { AuthManager } from './auth/AuthManager.js';
import { ChatController } from './chat/ChatController.js';
import { ResponseExtractor } from './chat/ResponseExtractor.js';
import { FeatureToggles } from './features/FeatureToggles.js';
import { FileUploader } from './file/FileUploader.js';
import { ContextManager } from './context/ContextManager.js';
import { Selectors } from './browser/Selectors.js';
import { TaskQueue } from './task/TaskQueue.js';
import { isImageFile } from './utils/fileUtils.js';
import { loadPrompt } from './utils/prompts.js';
import { getUploadsDir } from './utils/paths.js';
import { ContextExhaustedError, RestoreResult, ServerBusyError } from './types.js';

export class DeepSeekClient {
    public browserManager: BrowserManager;
    public authManager: AuthManager;
    public chatController: ChatController;
    public responseExtractor: ResponseExtractor;
    public featureToggles: FeatureToggles;
    public fileUploader: FileUploader;
    public contextManager: ContextManager;
    public page: any;
    public config: any;
    public taskQueue: TaskQueue;
    public needTransition: boolean = false;
    public currentChatId: string | null = null;
    public ragSearchActive: boolean = false;
    public apiKey: string = 'default';

    public lastLengthLimit: { detected: boolean; percent: number | null } = { detected: false, percent: null };

    private isInitialized: boolean = false;
    private chatStarted: boolean = false;
    private statePath: string;      // browser state (Playwright)
    private chatStatePath: string;  // chat state (DeepSeek)

    private systemPromptsSent: { tools: boolean; multiRole: boolean } = {
        tools: false,
        multiRole: false,
    };

    constructor(config: any = {}) {
        this.config = config;
        this.statePath = config.statePath || './state.json';
        this.chatStatePath = config.chatStatePath || './chat_state.json';
        this.browserManager = new BrowserManager();
        this.authManager = new AuthManager(this.browserManager);
        this.responseExtractor = new ResponseExtractor(this.browserManager);
        this.chatController = new ChatController(this.browserManager, this.responseExtractor);
        this.featureToggles = new FeatureToggles(this.browserManager);
        this.contextManager = new ContextManager(this);
        this.fileUploader = new FileUploader(this.chatController, this.contextManager);
        this.taskQueue = new TaskQueue(this);
        this.currentChatId = null;
    }

    isChatStarted(): boolean { return this.chatStarted; }
    setChatStarted(value: boolean): void { this.chatStarted = value; }

    // ============================================================
    // SYSTEM PROMPTS MANAGEMENT
    // ============================================================

    resetSystemPrompts(): void {
        this.systemPromptsSent = { tools: false, multiRole: false };
        console.log('🔄 System prompts reset');
    }

    isSystemPromptSent(type: 'tools' | 'multiRole'): boolean {
        return this.systemPromptsSent[type] || false;
    }

    setSystemPromptSent(type: 'tools' | 'multiRole'): void {
        this.systemPromptsSent[type] = true;
        console.log(`📌 System prompt "${type}" marked as sent`);
    }

    // ============================================================
    // PERSISTENT STATE
    // ============================================================

    /**
     * Save chat-session state to chat_state.json.
     * Kept separate from state.json (browser cookies) to avoid
     * validateEnvironment() overwriting the deepseek block at startup.
     */
    async saveChatState(): Promise<void> {
        const payload = {
            deepseek: {
                lastChatId: this.currentChatId,
                chatStarted: this.chatStarted,
                totalChars: this.contextManager.totalChars,
                ragSearchActive: this.ragSearchActive,
                snapshot70Done: this.contextManager.snapshot70Done,
                snapshot90Done: this.contextManager.snapshot90Done,
            },
        };

        fs.writeFileSync(this.chatStatePath, JSON.stringify(payload, null, 2));
        console.log(`💾 Chat state saved: ${this.currentChatId}`);
    }

    /**
     * Read chat-session state.
     * Primary source: chat_state.json.
     * Fallback: legacy `deepseek` key inside state.json (migrated on next save).
     * Returns null if neither source has valid data.
     */
    async loadChatState(): Promise<any> {
        if (fs.existsSync(this.chatStatePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.chatStatePath, 'utf-8'));
                return data.deepseek || null;
            } catch {
                return null;
            }
        }

        // Legacy fallback — old versions stored chat state inside state.json
        if (fs.existsSync(this.statePath)) {
            try {
                const state = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
                if (state.deepseek) {
                    console.log('📦 Legacy chat state found in state.json — will migrate on next save');
                    return state.deepseek;
                }
            } catch { /* ignore */ }
        }

        return null;
    }

    /**
     * Clear chat-session state (chat_state.json) — set all fields to defaults.
     * Does not touch state.json (browser cookies) or the snapshot file.
     */
    private async clearPersistentState(): Promise<void> {
        const payload = {
            deepseek: {
                lastChatId: null,
                chatStarted: false,
                totalChars: 0,
                ragSearchActive: false,
                snapshot70Done: false,
                snapshot90Done: false,
            },
        };
        fs.writeFileSync(this.chatStatePath, JSON.stringify(payload, null, 2));
    }

    // ============================================================
    // RECOVERY OPERATIONS
    // ============================================================

    /**
     * Start a fresh chat session. Clears all persistent state,
     * deletes the snapshot file, opens a new chat, and resets in-memory fields.
     */
    async startFresh(): Promise<void> {
        console.log('🆕 startFresh: new chat session');

        await this.clearPersistentState();
        await this.chatController.newChat();

        this.currentChatId = await this.chatController.getCurrentChatId();
        this.chatStarted = false;
        this.ragSearchActive = false;
        this.needTransition = false;
        this.lastLengthLimit = { detected: false, percent: null };
        this.resetSystemPrompts();
        this.contextManager.resetLanguageAnalysis();
        this.contextManager.totalChars = 0;
        this.contextManager.clearSnapshot();

        // A fresh chat means the user explicitly asked to start over.
        // Any RAG data from the previous project is no longer relevant.
        await this.clearRagIndexIfEnabled();

        await this.saveChatState();
    }

    /**
     * Restore the previous chat session by lastChatId from chat_state.json.
     * Returns { ok: false } if the chat is not found or state is empty.
     */
    async restorePrevious(): Promise<RestoreResult> {
        console.log('♻️ restorePrevious: trying to reopen last chat');

        const saved = await this.loadChatState();
        if (!saved || !saved.lastChatId) {
            console.log('   no lastChatId in chat state');
            return { ok: false, reason: 'no_last_chat_id' };
        }

        const exists = await this.chatController.chatExists(saved.lastChatId);
        if (!exists) {
            console.warn(`   chat ${saved.lastChatId} not found in sidebar`);
            await this.clearPersistentState();
            return { ok: false, reason: 'chat_not_found' };
        }

        const restored = await this.chatController.restoreChatById(saved.lastChatId);
        if (!restored) {
            await this.clearPersistentState();
            return { ok: false, reason: 'chat_not_found' };
        }

        this.currentChatId = saved.lastChatId;
        this.chatStarted = saved.chatStarted ?? false;
        this.ragSearchActive = saved.ragSearchActive ?? false;
        this.needTransition = false;
        this.lastLengthLimit = { detected: false, percent: null };

        this.contextManager.totalChars = saved.totalChars ?? 0;
        this.contextManager.snapshot70Done = saved.snapshot70Done ?? false;
        this.contextManager.snapshot90Done = saved.snapshot90Done ?? false;

        this.resetSystemPrompts();

        console.log(`   ✅ restored: chatId=${this.currentChatId}, ` +
            `totalChars=${this.contextManager.totalChars}, ` +
            `ragSearchActive=${this.ragSearchActive}, ` +
            `snapshot70Done=${this.contextManager.snapshot70Done}, ` +
            `snapshot90Done=${this.contextManager.snapshot90Done}`);

        return { ok: true };
    }

    /**
     * Clear the RAG index for the current session, if RAG is enabled.
     *
     * Called from startFresh(). Two paths are possible:
     *   - At server startup (during initialize()), the store has not been
     *     loaded yet, and the index file is simply truncated on disk.
     *   - During a running server (via /v1/chat/new {restore: false}),
     *     the store is in memory and is cleared and re-saved.
     *
     * Does nothing if RAG is disabled or the apiKey is not yet known.
     */
    private async clearRagIndexIfEnabled(): Promise<void> {
        if (process.env.ENABLE_RAG !== 'true') return;
        if (!this.apiKey || this.apiKey === 'default') return;

        try {
            const { clearHistoryStoreIfExists } = await import('./rag/init.js');
            clearHistoryStoreIfExists(this.apiKey);
        } catch (err) {
            console.warn(`⚠️ Could not clear RAG index: ${(err as Error).message}`);
        }
    }

    /**
     * Handle context overflow at the 90% threshold.
     * Called by SendUserMessageTask when needTransition is set.
     *
     * Behaviour depends on ENABLE_SNAPSHOT / ENABLE_RAG:
     *   - neither:  return false (GENERAL waits for the real banner)
     *   - SNAPSHOT: upload the snapshot into a new chat, then delete it
     *   - RAG:      transfer, activate ragSearchActive
     *   - both:     snapshot transfer first, then ragSearchActive = true
     */
    async handleOverflow(): Promise<boolean> {
        const enableSnapshot = process.env.ENABLE_SNAPSHOT === 'true';
        const enableRag = process.env.ENABLE_RAG === 'true';

        if (!enableSnapshot && !enableRag) {
            console.log('ℹ️ handleOverflow: neither SNAPSHOT nor RAG enabled — no transition');
            return false;
        }

        console.log(`🔄 handleOverflow: snapshot=${enableSnapshot}, rag=${enableRag}`);

        let snapshotPath: string | null = null;
        if (enableSnapshot) {
            snapshotPath = this.contextManager.getSnapshotPath();
            if (!snapshotPath) {
                console.warn('   ⚠️ SNAPSHOT enabled but no snapshot file found — plain transfer');
            }
        }

        // Switch to a new chat directly (no RESTORE recursion).
        await this.chatController.newChat();
        this.currentChatId = await this.chatController.getCurrentChatId();
        this.chatStarted = false;
        this.needTransition = false;
        this.lastLengthLimit = { detected: false, percent: null };
        this.resetSystemPrompts();
        this.contextManager.totalChars = 0;
        this.contextManager.resetLanguageAnalysis();

        // Upload the snapshot first (service data, before user text)
        if (enableSnapshot && snapshotPath && fs.existsSync(snapshotPath)) {
            console.log(`   📤 uploading snapshot: ${path.basename(snapshotPath)}`);

            const uploadPrompt = loadPrompt('snapshot_upload_prompt.txt', {
                required: true,
            });

            await this.executePipeline({
                text: uploadPrompt,
                filePath: snapshotPath,
                skipStatsUpdate: true,
            });

            this.contextManager.clearSnapshot();
        }

        if (enableRag) {
            this.ragSearchActive = true;
            console.log('   ✅ ragSearchActive = true');
        }

        await this.saveChatState();
        return true;
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        const savedBrowserState = await this.loadState();
        const isAuthenticated = savedBrowserState && savedBrowserState.cookies && savedBrowserState.cookies.length > 0;
        await this.browserManager.launch(this.config.headless, this.config.viewport, savedBrowserState);

        if (isAuthenticated) {
            await this.browserManager.goto('https://chat.deepseek.com');
        } else {
            await this.browserManager.goto('https://chat.deepseek.com/sign_in');
        }
        await this.browserManager.page!.waitForTimeout(3000);
        await this.authManager.ensureAuthenticated(this.config.email, this.config.password);
        await this.saveState();

        this.page = this.browserManager.page;

        await this.ensureEnglishLanguage();

        const enableRestore = process.env.ENABLE_RESTORE === 'true';
        if (enableRestore) {
            const result = await this.restorePrevious();
            if (!result.ok) {
                console.warn(`⚠️ restorePrevious failed (${result.reason}), starting fresh`);
                await this.startFresh();
            }
        } else {
            await this.startFresh();
        }

        this.isInitialized = true;
        console.log('✅ DeepSeek client ready!');
    }

    async ensureEnglishLanguage(): Promise<void> {
        console.log('🌐 Checking interface language...');
        const page = this.page;

        const isEnglish = await page.isVisible('textarea[placeholder*="Message DeepSeek"]').catch(() => false);
        if (isEnglish) {
            console.log('✅ Interface language is English');
            return;
        }

        console.log('⚠️ Switching language to English...');
        try {
            const opened = await this.openProfileMenu();
            if (!opened) {
                console.warn('⚠️ Could not open profile menu – language check skipped');
                return;
            }

            const settingsItem = await page.$(Selectors.settingsMenuItem);
            if (!settingsItem) {
                await page.keyboard.press('Escape');
                return;
            }
            await settingsItem.click();
            await page.waitForSelector(Selectors.languageSelect, { timeout: 5000 });

            const generalTab = await page.$(Selectors.settingsTabGeneral);
            if (generalTab) {
                await generalTab.click();
                await page.waitForTimeout(1000);
            }

            const langSelect = await page.$(Selectors.languageSelect);
            if (!langSelect) {
                await this.closeSettings();
                return;
            }
            await langSelect.click();
            await page.waitForSelector('.ds-select-option', { timeout: 3000 });

            const englishOption = await page.$(Selectors.languageOptionEnglish);
            if (englishOption) {
                await englishOption.click();
                await page.waitForTimeout(1500);
                console.log('✅ Language switched to English');
            } else {
                console.warn('⚠️ English language option not found, continuing with current language');
            }

            await this.closeSettings();
        } catch (err) {
            console.error('❌ Language switch failed:', (err as Error).message);
            await this.closeSettings().catch(() => {});
        }
    }

    private async closeSettings(): Promise<void> {
        const page = this.page;
        const closeBtn = await page.$(Selectors.settingsClose);
        if (closeBtn) {
            await closeBtn.click();
        } else {
            await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(1000);
    }

    async openProfileMenu(): Promise<boolean> {
        const page = this.page;
        return await page.evaluate(() => {
            const icons = document.querySelectorAll('.ds-icon');
            for (let i = 0; i < icons.length; i++) {
                const icon = icons[i];
                const svg = icon.querySelector('svg');
                if (svg && svg.innerHTML.includes('M4.55146 8.00001')) {
                    const parent = icon.closest('[tabindex="0"]') as HTMLElement | null;
                    if (parent) {
                        parent.click();
                        return true;
                    }
                }
            }
            return false;
        });
    }

    async saveState(): Promise<void> {
        const statePath = this.config.statePath || './state.json';
        await this.browserManager.saveState(statePath);
    }

    private async loadState(): Promise<any> {
        const statePath = this.config.statePath || './state.json';
        return await this.browserManager.loadState(statePath);
    }

    async cleanup(): Promise<void> {
        console.log('🧹 Cleaning up temporary files and context data...');
        const uploadsDir = getUploadsDir();
        if (fs.existsSync(uploadsDir)) {
            for (const file of fs.readdirSync(uploadsDir)) {
                try { fs.unlinkSync(path.join(uploadsDir, file)); } catch { /* ignore */ }
            }
        }
        await this.contextManager.clearAllContextData();
    }

    async close(): Promise<void> {
        await this.browserManager.close();
    }

    // ============================================================
    // DEEPSEEK AVAILABILITY
    // ============================================================

    async checkDeepSeekAvailable(): Promise<boolean> {
        const page = this.page;
        if (!page) return false;

        try {
            const hasRateLimit = await page.isVisible(
                '[class*="rate-limit"], [class*="too-many-requests"]'
            ).catch(() => false);
            const hasMaintenance = await page.isVisible(
                '[class*="maintenance"], [class*="service-unavailable"]'
            ).catch(() => false);
            const hasCaptcha = await page.isVisible(
                '[class*="captcha"], iframe[src*="captcha"]'
            ).catch(() => false);

            return !(hasRateLimit || hasMaintenance || hasCaptcha);
        } catch {
            return true;
        }
    }

    // ============================================================
    // SIDEBAR
    // ============================================================

    async isSidebarExpanded(): Promise<boolean> {
        return await this.page.getByText('New chat').isVisible().catch(() => false);
    }

    async ensureSidebarExpanded(): Promise<boolean> {
        const expanded = await this.isSidebarExpanded();
        if (expanded) return true;

        console.log('➜ Sidebar is collapsed, attempting to expand...');
        const toggleBtn = await this.page.$(Selectors.sidebarToggle);
        if (toggleBtn) {
            await toggleBtn.click();
            await this.page.waitForTimeout(1500);
            const nowExpanded = await this.isSidebarExpanded();
            if (nowExpanded) {
                console.log('✅ Sidebar expanded');
                return true;
            }
        }

        console.warn('⚠️ Could not expand sidebar, reloading page...');
        await this.page.reload();
        await this.page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
        await this.page.waitForTimeout(3000);
        return true;
    }

    // ============================================================
    // CHAT OPERATIONS
    // ============================================================

    /**
     * Send a single message and return the assistant reply.
     *
     * Public facade that applies feature toggles and then delegates the
     * send-and-wait work to executePipeline, which already handles the
     * modern response-wait algorithm (Stop/Continue, banner detection,
     * Copy extraction with markdown fallback).
     *
     * @param text    - Message text.
     * @param options - Optional toggles and file path.
     * @returns Assistant response as plain text.
     */
    async sendMessage(
        text: string,
        options: {
            deepthink?: boolean;
            webSearch?: boolean;
            filePath?: string;
        } = {}
    ): Promise<string> {
        const { deepthink, webSearch, filePath } = options;

        if (deepthink !== undefined) await this.featureToggles.setDeepThink(deepthink);
        if (webSearch !== undefined) {
            try {
                await this.featureToggles.setWebSearch(webSearch);
            } catch (e) {
                console.warn('⚠️ WebSearch toggle failed:', (e as Error).message);
            }
        }

        return await this.executePipeline({ text, filePath });
    }

    async getMaxMessageKey(): Promise<number> {
        const page = this.page;
        try {
            await page.waitForSelector(Selectors.virtualListItem, { timeout: 5000 });
        } catch {
            return 0;
        }
        const elements = await page.$$(Selectors.virtualListItem);
        let max = 0;
        for (const el of elements) {
            const key = parseInt(await el.getAttribute('data-virtual-list-item-key') || '0', 10);
            if (key > max) max = key;
        }
        return max;
    }

    // ============================================================
    // CHAT CREATION & RESTORATION
    // ============================================================

    /**
     * Public chat-creation entry point used by /v1/chat/new.
     * Delegates to startFresh or restorePrevious based on options.restore.
     */
    async newChat(options: { restore?: boolean } = {}): Promise<void> {
        if (options.restore) {
            const result = await this.restorePrevious();
            if (!result.ok) {
                throw new Error(`restore_failed:${result.reason}`);
            }
            return;
        }
        await this.startFresh();
    }

    // ============================================================
    // PIPELINE
    // ============================================================

    public async executePipeline(options: {
        text: string;
        filePath?: string | string[];
        skipStatsUpdate?: boolean;
    }): Promise<string> {
        const { text, filePath, skipStatsUpdate = false } = options;
        const lastKey = await this.getMaxMessageKey();

        if (filePath) {
            await this.fileUploader.upload(filePath, skipStatsUpdate);
            await this.page.focus(Selectors.mainTextarea);
            await this.page.keyboard.press('Escape');
        }

        await this.chatController.clearInput();
        if (text) {
            await this.chatController.typeMessage(text);
        }
        await this.chatController.send();

        // Early banner check — no answer will come if the limit is reached,
        // so we fail fast before waiting for a Stop button that never appears.
        await this.page.waitForTimeout(2000);
        const earlyWarning = await this.responseExtractor.detectBanner();
        if (earlyWarning) {
            console.warn('⚠️ DeepSeek: Length limit reached. Please start a new chat.');
            this.needTransition = true;
            this.lastLengthLimit = { detected: true, percent: null };
            return '';
        }

        // Wait for the full assistant response, handling Continue transparently.
        // ChatController.waitForFullResponse throws ContextExhaustedError if the
        // length-limit banner appears during generation.
        let response: string;
        try {
            response = await this.chatController.waitForFullResponse(lastKey);
        } catch (err) {
            if (err instanceof ContextExhaustedError) {
                err.chatId = this.currentChatId;
                err.charsUsed = this.contextManager.totalChars;
                err.charsLimit = this.contextManager.getDynamicMaxChars();
                err.ragEnabled = process.env.ENABLE_RAG === 'true';
                const parsed = await this.responseExtractor.detectLengthLimit();
                err.deepseekReadablePercent = parsed.percent;
                this.needTransition = true;
                this.lastLengthLimit = { detected: true, percent: parsed.percent };
            }
            throw err;
        }

        // An empty response from DeepSeek is never a valid result. Two cases
        // produce it: the "Server busy" placeholder, and unknown extraction
        // failures. Distinguish them by looking for the Retry placeholder in
        // the DOM; the first case is fatal for the whole process.
        if (response.length === 0) {
            const serverBusy = await this.responseExtractor.detectServerBusy();
            if (serverBusy) {
                console.error('🚫 DeepSeek server busy — shutting down.');
                throw new ServerBusyError();
            }
            throw new Error('Empty response from DeepSeek');
        }

        if (!skipStatsUpdate) {
            let addedChars = (text?.length || 0) + response.length;
            if (filePath) {
                const files = Array.isArray(filePath) ? filePath : [filePath];
                for (const f of files) {
                    if (!isImageFile(f)) {
                        try { addedChars += fs.readFileSync(f, 'utf-8').length; } catch { /* ignore */ }
                    }
                }
            }
            const isDeepThink = await this.featureToggles.isDeepThinkEnabled();
            let multiplier = 1;
            if (isDeepThink) {
                const raw = process.env.DEEPSEEK_DEEPTHINK_MULTIPLIER;
                const parsed = parseFloat(raw || '');
                multiplier = isNaN(parsed) ? 2.5 : parsed;
            }
            await this.contextManager.addChars(addedChars, multiplier);
            await this.contextManager.checkAndSnapshot();
            await this.saveChatState();
        }

        return response;
    }

    // ============================================================
    // CHAT SWITCHING
    // ============================================================

    async getCurrentChatId(): Promise<string | null> {
        return await this.chatController.getCurrentChatId();
    }

    async switchToChat(chatId: string): Promise<void> {
        await this.chatController.switchToChat(chatId);
        this.currentChatId = chatId;
        await this.saveChatState();
    }

    async createTemporaryChat(): Promise<void> {
        await this.chatController.newChat();
        this.currentChatId = await this.chatController.getCurrentChatId();
    }

    async executeInTemporaryChat(
        messages: any[],
        filePath?: string
    ): Promise<string> {
        const originalChatId = await this.getCurrentChatId();
        console.log(`📌 Original chat: ${originalChatId}`);

        await this.createTemporaryChat();
        console.log('📌 Temporary chat created');

        const userMessage = messages.filter(m => m.role === 'user').pop();
        if (!userMessage && !filePath) {
            throw new Error('No user message or file provided');
        }

        const prompt = userMessage?.content || '';
        const response = await this.executePipeline({
            text: prompt,
            filePath: filePath,
            skipStatsUpdate: true,
        });

        if (originalChatId) {
            await this.switchToChat(originalChatId);
            console.log(`🔄 Switched back to original chat ${originalChatId}`);
        }

        return response;
    }

    // ============================================================
    // GETTERS
    // ============================================================

    getToggles(): FeatureToggles {
        return this.featureToggles;
    }

    getPage(): any {
        return this.page;
    }
}

export default DeepSeekClient;