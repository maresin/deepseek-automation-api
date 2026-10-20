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
import { sleep } from './utils/delays.js';

/**
 * Outcome of a single executePipelineOnce call.
 *
 *   - 'ok'     — a non-empty response was extracted.
 *   - 'banner' — the length-limit banner appeared before any
 *                response. Not retryable; the caller handles it via
 *                needTransition / lastLengthLimit.
 *   - 'busy'   — empty response with the server-busy placeholder
 *                present. Retryable after a long cooldown.
 *   - 'empty'  — empty response with no busy marker. Retryable
 *                after a shorter cooldown.
 */
type PipelineResult =
    | { kind: 'ok'; response: string }
    | { kind: 'banner' }
    | { kind: 'busy' }
    | { kind: 'empty' };

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
    private stateLoadedAtMs: number = 0;

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
        // No fixed pause here: ensureAuthenticated waits for the network to
        // settle before probing.
        const didLogin = await this.authManager.ensureAuthenticated(
            this.config.email,
            this.config.password
        );
        // ensureAuthenticated may have just performed a fresh login, in which
        // case the in-memory cookies are newer than anything on disk. Force
        // the write so that a concurrent writer cannot block it.
        await this.saveState(didLogin); 

        this.page = this.browserManager.page;

        // Language is forced at the browser-context level via locale: 'en-US'
        // and Accept-Language in BrowserManager. Here we only verify that the
        // chat page loaded — a locale-independent check.
        const hasTextarea = await this.page.isVisible(Selectors.mainTextarea).catch(() => false);
        if (!hasTextarea) {
            throw new Error('Chat page did not load (mainTextarea not visible)');
        }
        console.log('✅ Chat page loaded');

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

    /**
     * Persist the browser state to disk.
     *
     * @param force - When true, skip the mtime guard and write
     *                unconditionally. Used immediately after a login
     *                flow, where the freshly produced cookies are by
     *                definition newer than anything another process
     *                could have written.
     */
    async saveState(force: boolean = false): Promise<void> {
        const statePath = this.config.statePath || './state.json';
        const loadedAt = force ? 0 : this.stateLoadedAtMs;
        await this.browserManager.saveState(statePath, loadedAt);
    }

    private async loadState(): Promise<any> {
        const statePath = this.config.statePath || './state.json';

        // Record the mtime at read time. saveState() uses this to
        // detect concurrent writers.
        try {
            this.stateLoadedAtMs = fs.statSync(statePath).mtimeMs;
        } catch {
            this.stateLoadedAtMs = 0;
        }

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

    /**
     * Send a message and wait for a response, retrying on
     * server-busy conditions.
     *
     * Retry policy (configurable via .env):
     *
     *   DEEPSEEK_BUSY_MAX_RETRIES   (default 3)  number of retries
     *                                            after the first
     *                                            attempt
     *   DEEPSEEK_BUSY_DELAY_MS      (default 300000 = 5 minutes)
     *                                            delay between retries
     *                                            when the busy marker
     *                                            is present
     *
     * When the response is empty and the busy marker is found in the
     * DOM, the request is retried after the long delay — DeepSeek
     * needs several minutes of cooldown before it accepts the next
     * request. When the response is empty without any marker, a
     * shorter 15-second delay is used. When retries are exhausted,
     * a ServerBusyError is thrown and translated to HTTP 503 by the
     * route layer.
     *
     * Notes on retry side-effects:
     *
     *   - Each retry re-sends the message. The previous attempt's
     *     user message remains visible in the chat, so the
     *     conversation history will contain duplicate user messages
     *     when retries occur. This is a known trade-off: alternative
     *     approaches (clicking the "Regenerate" button in the
     *     placeholder) are planned for a future iteration.
     *   - File attachments are consumed by the first send attempt
     *     and are not re-uploaded on retry. If a request carries
     *     files, set DEEPSEEK_BUSY_MAX_RETRIES=0 to disable retry.
     *
     * @param options - text, optional filePath(s), skipStatsUpdate.
     * @returns The assistant's response text, or an empty string if
     *          the length-limit banner fired (caller handles it).
     * @throws ServerBusyError when retries are exhausted.
     * @throws ContextExhaustedError when the banner fired mid-response.
     */
    public async executePipeline(options: {
        text: string;
        filePath?: string | string[];
        skipStatsUpdate?: boolean;
    }): Promise<string> {
        const maxRetries = parseInt(
            process.env.DEEPSEEK_BUSY_MAX_RETRIES || '3', 10
        );
        const busyDelayMs = parseInt(
            process.env.DEEPSEEK_BUSY_DELAY_MS || '300000', 10
        );
        const emptyDelayMs = 15000;   // 15 seconds for plain empty
        const maxAttempts = maxRetries + 1;

        let attempt = 0;
        while (true) {
            attempt++;
            const result = await this.executePipelineOnce(options);

            if (result.kind === 'ok') {
                if (attempt > 1) {
                    console.log(
                        `✅ Response received on attempt ${attempt}/${maxAttempts}`
                    );
                }
                return result.response;
            }

            if (result.kind === 'banner') {
                // Length limit — not retryable. Return empty; the
                // caller sees needTransition / lastLengthLimit and
                // converts this into a ContextExhaustedError.
                return '';
            }

            // busy or empty
            const delayMs = result.kind === 'busy' ? busyDelayMs : emptyDelayMs;

            if (attempt >= maxAttempts) {
                console.error(
                    `🚫 DeepSeek ${result.kind} persists after ${attempt} ` +
                    `attempt(s) — giving up`
                );
                throw new ServerBusyError({
                    kind: result.kind,
                    attempts: attempt,
                });
            }

            console.warn(
                `⚠️ DeepSeek ${result.kind} (attempt ${attempt}/${maxAttempts}); ` +
                `retry in ${Math.round(delayMs / 1000)}s`
            );
            await sleep(delayMs);
        }
    }

    /**
     * One pass of the pipeline: upload any files, send the message,
     * wait for the response, extract it, and return the outcome
     * without retrying.
     *
     * The retry loop lives in executePipeline. Keeping the single
     * pass in a separate method makes the retry policy easy to
     * reason about — the loop never has to look at the DOM directly,
     * it only decides what to do based on the returned kind.
     */
    private async executePipelineOnce(options: {
        text: string;
        filePath?: string | string[];
        skipStatsUpdate?: boolean;
    }): Promise<PipelineResult> {
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

        // Early banner check — no answer will come if the limit is
        // reached, so we fail fast before waiting for a Stop button
        // that never appears.
        await this.page.waitForTimeout(2000);
        const earlyWarning = await this.responseExtractor.detectBanner();
        if (earlyWarning) {
            console.warn('⚠️ DeepSeek: Length limit reached. Please start a new chat.');
            this.needTransition = true;
            this.lastLengthLimit = { detected: true, percent: null };
            return { kind: 'banner' };
        }

        // Wait for the full assistant response, handling Continue
        // transparently. ChatController.waitForFullResponse throws
        // ContextExhaustedError if the length-limit banner appears
        // during generation — that error propagates as an exception,
        // not as an empty response, so the retry loop is bypassed.
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

        // Thinking-phase interruption. Even when a partial answer
        // was produced, it is unreliable — generation was cut. The
        // correct recovery is Regenerate, not accepting what is
        // there. Click once and wait for the replacement.
        const assistantKey = lastKey + 2;
        const stopped = await this.responseExtractor.detectThinkingStopped(assistantKey);
        if (stopped) {
            console.warn('⚠️ Thinking interrupted (Stopped marker) — clicking Regenerate');
            const clicked = await this.chatController.clickRegenerate(assistantKey);
            if (clicked) {
                try {
                    const regenerated = await this.chatController.waitForFullResponse(lastKey);
                    const stillStopped = await this.responseExtractor
                        .detectThinkingStopped(assistantKey);
                    if (!stillStopped && regenerated.length > 0) {
                        // Fall through to normal processing with the
                        // regenerated response.
                        response = regenerated;
                    } else {
                        console.warn(
                            '⚠️ Regenerate did not resolve the interruption — ' +
                            'escalating to retry'
                        );
                        return { kind: 'empty' };
                    }
                } catch (err) {
                    console.warn(
                        `⚠️ Regenerate failed: ${(err as Error).message}`
                    );
                    return { kind: 'empty' };
                }
            } else {
                return { kind: 'empty' };
            }
        }

        // Empty response — distinguish the two causes.
        //   busy  : placeholder is present; long cooldown
        //   empty : no marker; short cooldown
        if (response.length === 0) {
            const serverBusy = await this.responseExtractor.detectServerBusy();
            return serverBusy ? { kind: 'busy' } : { kind: 'empty' };
        }

        // Success — update context accounting.
        if (!skipStatsUpdate) {
            let addedChars = (text?.length || 0) + response.length;
            if (filePath) {
                const files = Array.isArray(filePath) ? filePath : [filePath];
                for (const f of files) {
                    if (!isImageFile(f)) {
                        try {
                            addedChars += fs.readFileSync(f, 'utf-8').length;
                        } catch { /* ignore */ }
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

        return { kind: 'ok', response };
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