// src/chat/ChatController.ts
/**
 * @file src/chat/ChatController.ts
 * Controls chat operations: sending messages, attaching files, managing chat state.
 * Provides the primary response-wait algorithm used by executePipeline.
 */

import fs from 'fs';
import path from 'path';
import { BrowserManager } from '../browser/BrowserManager.js';
import { ResponseExtractor } from './ResponseExtractor.js';
import { Selectors } from '../browser/Selectors.js';
import { ContextExhaustedError } from '../types.js';

const PHASE_A_MAX_MS = 10000;      // Active search for Stop
const STATE_CONFIRM_MS = 1000;     // Confirmation window for "Send(disabled) && !Stop"
const MAX_CONTINUE = 20;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

export class ChatController {
    constructor(
        private browserManager: BrowserManager,
        private responseExtractor: ResponseExtractor
    ) {}

    // ============================================================
    // INPUT / SEND
    // ============================================================

    async clearInput(): Promise<void> {
        const page = this.browserManager.page!;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        await page.waitForSelector(Selectors.mainTextarea, { state: 'visible' });
        await page.click(Selectors.mainTextarea);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
    }

    async typeMessage(message: string): Promise<void> {
        const page = this.browserManager.page!;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        await page.waitForSelector(Selectors.mainTextarea, { state: 'visible' });
        await page.click(Selectors.mainTextarea);
        if (message.length <= 50) {
            for (const char of message) {
                await page.keyboard.type(char);
                await page.waitForTimeout(50);
            }
        } else {
            await page.keyboard.insertText(message);
            await page.waitForTimeout(200);
        }
    }

    async send(): Promise<void> {
        const page = this.browserManager.page!;
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        const textAfterEnter = await page.inputValue(Selectors.mainTextarea).catch(() => '');
        if (textAfterEnter && textAfterEnter.length > 0) {
            const sendButton = await page.$(Selectors.sendButton);
            if (sendButton) {
                await sendButton.click();
                console.log('   Clicked send button as fallback');
            }
        }
    }

    async attachFile(filePaths: string | string[]): Promise<void> {
        const page = this.browserManager.page!;
        const files = Array.isArray(filePaths) ? filePaths : [filePaths];

        // Attach via paperclip (coordinate click, no native dialog)
        const textarea = await page.$(Selectors.mainTextarea);
        if (!textarea) throw new Error('Main textarea not found');
        const box = await textarea.boundingBox();
        if (!box) throw new Error('Cannot get textarea position');
        const x = box.x + box.width + 40;
        const y = box.y + box.height / 2;
        await page.mouse.click(x, y);
        await page.waitForTimeout(500);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        const inputs = await page.$$(Selectors.fileInput);
        if (inputs.length === 0) throw new Error('File input not found');
        const fileInput = inputs[inputs.length - 1];
        await fileInput.setInputFiles(files);

        // Wait for the file badge. The selector matches the SVG path directly.
        try {
            await page.waitForSelector('svg path[d^="M10.6074 4.40278"]', { timeout: 30000 });
        } catch {
            const formatWarning = await page.isVisible(
                'text=The uploaded file format is not supported'
            ).catch(() => false);
            if (formatWarning) {
                throw new Error(
                    `DeepSeek rejected file format: ${files.map(f => path.basename(f)).join(', ')}`
                );
            }
            throw new Error(
                `File badge did not appear within 30s for: ${files.map(f => path.basename(f)).join(', ')}`
            );
        }

        // Retry loop for the "Server busy" state. DeepSeek sometimes rejects
        // the file on the first attempt; clicking the badge triggers a retry.
        const deadline = Date.now() + 120000;
        let retries = 0;

        while (Date.now() < deadline) {
            if (await page.isVisible(Selectors.sendButton).catch(() => false)) {
                await page.keyboard.press('Escape');
                await page.focus(Selectors.mainTextarea);
                console.log(`   ✅ File(s) attached: ${files.map(f => path.basename(f)).join(', ')}`);
                return;
            }

            const busy = await page.evaluate(() => {
                const xs = document.querySelectorAll('svg path[d^="M10.6074 4.40278"]');
                for (let i = 0; i < xs.length; i++) {
                    const xPath = xs[i];
                    const badge = xPath.closest('.ds-animated-size-item');
                    if (!badge) continue;
                    const text = (badge.textContent || '').toLowerCase();
                    if (/server\s+busy|upload\s+failed|network\s+error|retry|try\s+again/.test(text)) {
                        const r = (badge as HTMLElement).getBoundingClientRect();
                        return {
                            found: true,
                            x: r.x + 20,
                            y: r.y + r.height / 2,
                            text: (badge.textContent || '').trim(),
                        };
                    }
                }
                return { found: false, x: 0, y: 0, text: '' };
            });

            if (busy.found) {
                if (retries >= 5) {
                    throw new Error(
                        `DeepSeek refused files 5 times with "${busy.text}": ` +
                        `${files.map(f => path.basename(f)).join(', ')}`
                    );
                }
                retries++;
                console.log(`   ⚠️ Badge: "${busy.text}" — clicking to retry (${retries}/5)...`);
                await page.mouse.click(busy.x, busy.y);
                await page.waitForTimeout(4000);
                continue;
            }

            await page.waitForTimeout(500);
        }

        throw new Error(
            `Send did not become enabled within 120s for: ` +
            `${files.map(f => path.basename(f)).join(', ')}` +
            (retries ? ` (retried ${retries})` : '')
        );
    }

    // ============================================================
    // NEW CHAT
    // ============================================================

    async newChat(): Promise<void> {
        const page = this.browserManager.page!;
        const newChatBtn = page.getByText('New chat');
        if (await newChatBtn.isVisible().catch(() => false)) {
            await newChatBtn.click();
            await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
            console.log('✅ New chat created');
            return;
        }
        const iconBtn = await page.$(Selectors.newChatButtonIcon);
        if (iconBtn) {
            await iconBtn.click();
            await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
            console.log('✅ New chat created (via icon)');
            return;
        }
        throw new Error('New chat button not found');
    }

    /**
     * If a floating "scroll to bottom" button is visible, click it to
     * bring the message list to the end.
     *
     * Long assistant messages extend below the viewport. In that state,
     * both the Continue button and the footer Copy button live outside
     * the visible area — and DeepSeek's virtual list may not render them
     * at all. Scrolling to the bottom before checking for Continue or
     * extracting the response makes both reliably reachable.
     *
     * @returns true if a scroll was performed, false if no scroll was needed.
     */
    async scrollToBottomIfNeeded(): Promise<boolean> {
        const page = this.browserManager.page!;
        const visible = await page.isVisible(Selectors.scrollToBottomButton).catch(() => false);
        if (!visible) return false;

        await page.click(Selectors.scrollToBottomButton);
        await page.waitForTimeout(500);
        return true;
    }

    // ============================================================
    // RESPONSE-WAIT ALGORITHM
    // ============================================================

    /**
     * Snapshot of the trigger state — Stop present, Send in disabled state,
     * banner present. Single round-trip to the page.
     */
    private async getTriggerState(): Promise<{
        stop: boolean;
        sendDisabled: boolean;
        banner: string | null;
    }> {
        const page = this.browserManager.page!;
        return await page.evaluate((cfg) => {
            const stop = !!document.querySelector(cfg.stopSelector);
            const sendEls = Array.from(document.querySelectorAll(cfg.sendSelector));
            const sendDisabled = sendEls.some(el => el.classList.contains('ds-button--disabled'));
            const text = document.body.textContent || '';
            const re = new RegExp(cfg.bannerPattern, 'i');
            const m = text.match(re);
            return { stop, sendDisabled, banner: m ? m[0] : null };
        }, {
            stopSelector: Selectors.stopButton,
            sendSelector: Selectors.sendButtonExists,
            bannerPattern: Selectors.lengthLimitBannerPattern.source,
        });
    }

    /**
     * Wait for the current chunk of the response to complete.
     *
     * Combined strategy:
     *   Phase A (0..10 s, 100 ms polling): actively look for Stop.
     *     - Stop appears → switch to Phase B (transition).
     *     - "Send(disabled) && !Stop" persists for STATE_CONFIRM_MS → done
     *       (covers very short replies where Stop flickers between polls).
     *     - banner appears → return { status: 'banner' }.
     *   Phase B: wait for Stop to disappear, then confirm Send is disabled.
     *
     * @returns status, trigger, timing, banner.
     */
    private async waitForChunkComplete(
        deadline: number
    ): Promise<{
        status: 'done' | 'banner' | 'timeout';
        trigger: 'transition' | 'state_persisted' | 'none';
        phaseAms: number;
        phaseBms: number;
        banner: string | null;
    }> {
        const phaseAStart = Date.now();
        let stopSeen = false;
        let stateSince: number | null = null;

        // ---- Phase A ----
        while (Date.now() - phaseAStart < PHASE_A_MAX_MS && Date.now() < deadline) {
            const s = await this.getTriggerState();

            if (s.banner) {
                return {
                    status: 'banner',
                    trigger: 'none',
                    phaseAms: Date.now() - phaseAStart,
                    phaseBms: 0,
                    banner: s.banner,
                };
            }
            if (s.stop) {
                stopSeen = true;
                break;
            }
            if (s.sendDisabled && !s.stop) {
                if (stateSince === null) {
                    stateSince = Date.now();
                } else if (Date.now() - stateSince >= STATE_CONFIRM_MS) {
                    return {
                        status: 'done',
                        trigger: 'state_persisted',
                        phaseAms: Date.now() - phaseAStart,
                        phaseBms: 0,
                        banner: null,
                    };
                }
            } else {
                stateSince = null;
            }
            await this.browserManager.page!.waitForTimeout(100);
        }

        const phaseAms = Date.now() - phaseAStart;

        if (!stopSeen) {
            return {
                status: 'timeout',
                trigger: 'none',
                phaseAms,
                phaseBms: 0,
                banner: null,
            };
        }

        // ---- Phase B: wait for Stop to disappear ----
        const phaseBStart = Date.now();
        while (Date.now() < deadline) {
            const s = await this.getTriggerState();

            if (s.banner) {
                return {
                    status: 'banner',
                    trigger: 'transition',
                    phaseAms,
                    phaseBms: Date.now() - phaseBStart,
                    banner: s.banner,
                };
            }
            if (!s.stop) {
                // Confirm Send(disabled) with a short retry window
                for (let i = 0; i < 10; i++) {
                    await this.browserManager.page!.waitForTimeout(200);
                    const s2 = await this.getTriggerState();
                    if (s2.banner) {
                        return {
                            status: 'banner',
                            trigger: 'transition',
                            phaseAms,
                            phaseBms: Date.now() - phaseBStart,
                            banner: s2.banner,
                        };
                    }
                    if (s2.sendDisabled && !s2.stop) {
                        return {
                            status: 'done',
                            trigger: 'transition',
                            phaseAms,
                            phaseBms: Date.now() - phaseBStart,
                            banner: null,
                        };
                    }
                    if (s2.stop) break; // Stop reappeared — keep waiting
                }
            }
            await this.browserManager.page!.waitForTimeout(500);
        }

        return {
            status: 'timeout',
            trigger: 'transition',
            phaseAms,
            phaseBms: Date.now() - phaseBStart,
            banner: null,
        };
    }

    /**
     * Wait for the full assistant response, handling Continue seamlessly.
     * The assistant block key does NOT change when Continue is clicked.
     *
     * Extraction path: footer Copy → markdown fallback. The fallback is
     * used when the Copy click cannot find a real footer Copy button
     * (DeepSeek markup change, missing button, etc.).
     *
     * @param lastKey — max data-virtual-list-item-key before sending.
     * @param timeoutMs — overall timeout.
     * @returns the complete assistant text.
     * @throws ContextExhaustedError if the length limit banner appears.
     */
    async waitForFullResponse(
        lastKey: number,
        timeoutMs: number = DEFAULT_TIMEOUT_MS
    ): Promise<string> {
        const page = this.browserManager.page!;
        const assistantKey = lastKey + 2;
        const deadline = Date.now() + timeoutMs;

        console.log(`   Waiting for response (assistantKey=${assistantKey})...`);

        for (let iter = 0; iter <= MAX_CONTINUE; iter++) {
            const step = await this.waitForChunkComplete(deadline);

            if (step.status === 'banner') {
                console.warn(`   🚫 length limit banner: "${step.banner}"`);
                throw new ContextExhaustedError(step.banner || 'Length limit reached');
            }
            if (step.status === 'timeout') {
                throw new Error(
                    `Timeout waiting for response (iter=${iter}, phaseA=${step.phaseAms}ms, phaseB=${step.phaseBms}ms)`
                );
            }

            console.log(
                `   [iter ${iter}] chunk done (trigger=${step.trigger}, ` +
                `phaseA=${step.phaseAms}ms, phaseB=${step.phaseBms}ms)`
            );

            // Bring the message list to the bottom so Continue and Copy
            // (both in the assistant footer) are visible and rendered.
            await this.scrollToBottomIfNeeded();

            // Re-check banner after Stop disappears (banner can arrive with Stop still visible)
            const lateBanner = await this.responseExtractor.detectBanner();
            if (lateBanner) {
                throw new ContextExhaustedError(lateBanner);
            }

            // Continue?
            const hasContinue = await this.responseExtractor.hasContinueButton(assistantKey);
            if (hasContinue) {
                console.log(`   [iter ${iter}] Continue detected — clicking`);
                try {
                    await page.getByRole('button', { name: Selectors.continueButtonText })
                        .first()
                        .click({ timeout: 5000 });
                } catch (err) {
                    throw new Error(`Failed to click Continue: ${(err as Error).message}`);
                }
                // Wait for Stop to reappear — generation resumed
                try {
                    await page.waitForSelector(Selectors.stopButton, { state: 'visible', timeout: 5000 });
                    console.log(`   [iter ${iter}] Stop reappeared — continuation started`);
                } catch {
                    console.log(`   [iter ${iter}] Stop not seen after Continue click; continuing anyway`);
                }
                continue;
            }

            // No Continue → extract the whole answer via footer Copy
            const copy = await this.responseExtractor.getCopyTextByKeyWithRegenerate(assistantKey);
            if (copy.ok) {
                console.log(`   ✅ Response extracted: ${(copy.text || '').length} chars (depth=${copy.depth})`);
                return copy.text || '';
            }

            // Copy failed — fall back to reading the markdown body
            // directly from the DOM. This path is a safety net for
            // scenarios where the Copy button is missing or changed.
            console.warn(`   ⚠️ Copy extraction failed (${copy.reason}), trying markdown fallback`);
            const fallback = await this.responseExtractor.getResponseViaMarkdown(assistantKey);
            if (fallback && fallback.length > 0) {
                console.log(`   ✅ Response extracted via fallback: ${fallback.length} chars`);
                return fallback;
            }

            throw new Error(`Failed to extract response: ${copy.reason}`);
        }

        throw new Error(`Max Continue iterations (${MAX_CONTINUE}) exceeded`);
    }

    async waitForTempNewChatButton(timeoutMs: number = 10000): Promise<boolean> {
        const page = this.browserManager.page!;
        try {
            await page.waitForSelector(Selectors.newChatButtonIcon, { timeout: timeoutMs });
            return true;
        } catch {
            return false;
        }
    }

    // ============================================================
    // CHAT ID / SWITCH
    // ============================================================

    async getCurrentChatId(): Promise<string | null> {
        const page = this.browserManager.page!;
        const url = page.url();
        const match = url.match(/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    async switchToChat(chatId: string): Promise<void> {
        const page = this.browserManager.page!;
        await page.goto(`https://chat.deepseek.com/a/chat/s/${chatId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
        console.log(`🔄 Switched to chat ${chatId}`);
    }

    async chatExists(chatId: string): Promise<boolean> {
        const page = this.browserManager.page!;
        const link = await page.$(`a[href*="/a/chat/s/${chatId}"]`);
        return link !== null;
    }

    async restoreChatById(chatId: string): Promise<boolean> {
        const page = this.browserManager.page!;
        const link = await page.$(`a[href*="/a/chat/s/${chatId}"]`);
        if (!link) {
            console.warn(`⚠️ Chat ${chatId} not found in sidebar`);
            return false;
        }
        await link.click();
        await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
        console.log(`✅ Restored chat ${chatId}`);
        return true;
    }

    async isNewChatButtonPresent(): Promise<boolean> {
        const page = this.browserManager.page!;
        const visible = await page.getByText('New chat').isVisible().catch(() => false);
        if (visible) return true;
        return (await page.$(Selectors.newChatButtonIcon)) !== null;
    }
}