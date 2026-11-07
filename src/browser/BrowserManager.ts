// src/browser/BrowserManager.ts
/**
 * @file src/browser/BrowserManager.ts
 * Owns the Playwright browser lifecycle and the active page.
 *
 * Two modes, selected by DEEPSEEK_CDP_URL:
 *
 *   - CDP mode (DEEPSEEK_CDP_URL set). Playwright does NOT launch
 *     a browser. It connects to an already-running Chrome instance
 *     via the Chrome DevTools Protocol. The Chrome process belongs
 *     to the caller (the user, or a host extension like Pingis),
 *     runs with normal flags and profile, and is shared between
 *     multiple agent processes.
 *
 *     Tab lifecycle:
 *       - On launch, if `expectedChatId` is provided (from
 *         chat_state.json's lastChatId), we scan existing tabs for
 *         a URL matching /a/chat/s/<id>. If found, we reuse that
 *         tab. This survives an unclean restart: the previous
 *         process crashed, the tab is still there, the new
 *         process picks it up.
 *       - If no matching tab exists, a new tab is created.
 *       - On close, only OUR tab is closed. Chrome keeps running
 *         for other agents and for the next restart of this agent
 *         (tab reuse relies on that).
 *
 *   - Stateless mode (default). Playwright launches its own browser
 *     (bundled Chromium or system Chrome, selected by
 *     DEEPSEEK_BROWSER) with an empty profile and restores cookies
 *     from state.json. Fast, stateless, works when Cloudflare is
 *     not blocking.
 *
 * In CDP mode, state.json is not used: the Chrome profile on disk
 * is the source of truth, and saveState()/loadState() become no-ops.
 *
 * In both modes, two behaviour patches are installed on the page:
 *
 *   1. Clipboard isolation. DeepSeek's "Copy" button writes into
 *      the browser clipboard. In a shared profile the read-back
 *      could return stale content, so we replace
 *      navigator.clipboard with an in-page buffer.
 *
 *   2. Webdriver flag removal. DeepSeek inspects navigator.webdriver
 *      and degrades the UI in an automated browser; the init script
 *      clears it.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { getChromeLaunchOptions, describeBrowserChoice } from './chromeLauncher.js';
import { ensureChromeCdp, stopChromeCdp, getCdpUrl } from './chromeCdp.js';
import fs from 'fs';

export class BrowserManager {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    public page: Page | null = null;

    /**
     * Launch or connect to a browser and open the initial page.
     *
     * @param headless        - Run without a visible window (ignored in
     *                          CDP mode: the user's Chrome is always visible).
     * @param viewport        - Viewport size (ignored in CDP mode: the
     *                          user's window size wins).
     * @param storageState    - Playwright storage state (ignored in CDP mode).
     * @param expectedChatId  - If non-null and in CDP mode, look for an
     *                          existing tab whose URL matches this chat id.
     *                          If found, reuse it; otherwise create a new one.
     *                          Ignored in stateless mode.
     */
    async launch(
        headless: boolean,
        viewport: any,
        storageState?: any,
        expectedChatId?: string | null,
    ): Promise<void> {
        const cdpUrl = process.env.DEEPSEEK_CDP_URL?.trim();

        if (cdpUrl) {
            await this.launchViaCDP(cdpUrl, expectedChatId ?? null);
            return;
        }

        console.log(`🌐 Browser: ${describeBrowserChoice()}`);
        await this.launchStateless(headless, viewport, storageState);
    }

    // ============================================================
    // CDP MODE
    // ============================================================

    /**
     * Connect to an already-running Chrome via CDP.
     *
     * Tab reuse: if `expectedChatId` is non-null, look for an existing
     * tab whose URL matches /a/chat/s/<expectedChatId>. If found,
     * reuse it. This is how a restarted agent (or a crashed one)
     * picks up where it left off without opening a fresh chat.
     *
     * The Chrome instance is NOT closed by close(): the profile must
     * survive API restarts so that the authenticated session
     * persists and other agents keep working.
     */
    private async launchViaCDP(
        cdpUrl: string,
        expectedChatId: string | null,
    ): Promise<void> {
        // Ensure Chrome is running with CDP. If it is already running
        // (external process — the user's, or Pingis'), this is a no-op
        // and we will not touch its lifecycle. If not, we launch it.
        const ready = await ensureChromeCdp();
        if (!ready) {
            throw new Error(
                `Chrome CDP is not available at ${cdpUrl} and autolaunch ` +
                `failed or was disabled. Set DEEPSEEK_CDP_AUTOLAUNCH=true ` +
                `(default) or start Chrome manually.`
            );
        }

        console.log(`🌐 CDP connect: ${cdpUrl}`);

        this.browser = await chromium.connectOverCDP(cdpUrl);
        this.browser.on('disconnected', () => {
            console.warn('⚠️ CDP connection lost');
        });

        const contexts = this.browser.contexts();
        if (contexts.length === 0) {
            throw new Error(
                `No browser contexts at ${cdpUrl}. Is Chrome running with ` +
                `--remote-debugging-port? Check: curl -s ${cdpUrl}/json/version`
            );
        }
        this.context = contexts[0];

        const agentName = process.env.DEEPSEEK_AGENT_NAME || 'default';

        // Tab reuse: search for a tab already open on the expected chat.
        let reused: Page | null = null;
        if (expectedChatId) {
            for (const p of this.context.pages()) {
                const m = p.url().match(/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/);
                if (m && m[1] === expectedChatId) {
                    reused = p;
                    break;
                }
            }
        }

        if (reused) {
            this.page = reused;
            console.log(
                `♻️ Reusing existing tab for ${agentName} ` +
                `(chat ${expectedChatId})`
            );
        } else {
            this.page = await this.context.newPage();
            console.log(`📑 New tab for ${agentName}`);
        }

        // Init scripts do not retroactively apply to already-open
        // pages. Navigation later triggers them for the new document.
        await this.installClipboardIsolation(this.context);
        await this.installWebdriverMask(this.page);
    }

    // ============================================================
    // STATELESS MODE (auto-launch)
    // ============================================================

    private async launchStateless(
        headless: boolean,
        viewport: any,
        storageState: any,
    ): Promise<void> {
        this.browser = await chromium.launch({
            headless,
            ...getChromeLaunchOptions(),
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ],
        });

        this.context = await this.browser.newContext({
            viewport,
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            storageState,
            permissions: ['clipboard-read', 'clipboard-write'],
            // Force English at the protocol level. DeepSeek reads
            // Accept-Language to decide the UI language; without
            // this, Playwright sends the system locale and every
            // text-based selector fails.
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        await this.installClipboardIsolation(this.context);

        this.page = await this.context.newPage();
        await this.installWebdriverMask(this.page);
    }

    // ============================================================
    // INIT SCRIPTS (shared)
    // ============================================================

    private async installClipboardIsolation(context: BrowserContext): Promise<void> {
        await context.addInitScript(() => {
            if ((window as any).__playwright_clipboard_isolated) return;

            let clipboardData = '';

            class FakeClipboardItem {
                constructor(public data: string) {}
                async getType(type: string) {
                    if (type === 'text/plain') {
                        return new Blob([this.data], { type: 'text/plain' });
                    }
                    throw new Error('Unsupported type');
                }
            }

            const fakeClipboard = {
                async writeText(text: string): Promise<void> {
                    clipboardData = text;
                    console.log('[IsolatedClipboard] writeText:', text.substring(0, 50));
                },
                async readText(): Promise<string> {
                    console.log('[IsolatedClipboard] readText returning:', clipboardData.substring(0, 50));
                    return clipboardData;
                },
                async write(items: any[]): Promise<void> {
                    for (const item of items) {
                        const blob = await item.getType('text/plain');
                        const text = await blob.text();
                        clipboardData = text;
                    }
                },
                async read(): Promise<any[]> {
                    return [new FakeClipboardItem(clipboardData)];
                },
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent() { return true; },
            };

            Object.defineProperty(navigator, 'clipboard', {
                value: fakeClipboard,
                writable: false,
                configurable: true,
            });

            (window as any).__playwright_clipboard_isolated = true;
        });
    }

    private async installWebdriverMask(page: Page): Promise<void> {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
    }

    // ============================================================
    // NAVIGATION
    // ============================================================

    async goto(url: string): Promise<void> {
        await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page!.waitForTimeout(500);
    }

    // ============================================================
    // STATE PERSISTENCE
    // ============================================================

    async saveState(statePath: string, loadedAtMs: number = 0): Promise<boolean> {
        if (process.env.DEEPSEEK_CDP_URL) {
            console.log('💾 State write skipped (CDP mode: Chrome profile is the source of truth)');
            return false;
        }

        if (!this.context) return false;

        if (loadedAtMs > 0) {
            try {
                const stat = fs.statSync(statePath);
                if (stat.mtimeMs > loadedAtMs) {
                    console.log(
                        `💾 Skipping state write: file is newer ` +
                        `(mtime ${stat.mtimeMs} > ${loadedAtMs})`
                    );
                    return false;
                }
            } catch {
                // File disappeared — safe to write.
            }
        }

        const state = await this.context.storageState();
        const tmp = statePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, statePath);
        console.log(`💾 State saved (${state.cookies?.length || 0} cookies)`);
        return true;
    }

    async loadState(statePath: string): Promise<any> {
        if (process.env.DEEPSEEK_CDP_URL) {
            return undefined;
        }
        if (fs.existsSync(statePath)) {
            return JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }
        return undefined;
    }

    // ============================================================
    // SHUTDOWN
    // ============================================================

    /**
     * Close the context and the browser.
     *
     * In CDP mode, close only OUR tab and disconnect. Chrome keeps
     * running for the other agents (they share the same Chrome
     * process). The next restart of this agent may reuse the tab
     * by chat id — but since we clean up here, an unclean restart
     * (SIGKILL) is what leaves the tab behind for reuse.
     */
    async close(): Promise<void> {
        if (process.env.DEEPSEEK_CDP_URL) {
            if (this.page && !this.page.isClosed()) {
                await this.page.close().catch(() => { /* ignore */ });
            }
            this.page = null;

            if (this.browser) {
                await this.browser.close().catch(() => { /* ignore */ });
                this.browser = null;
            }
            this.context = null;

            // Close Chrome only if we launched it AND autoclose is on.
            // External Chrome (Pingis, or user-launched) is left alone.
            stopChromeCdp();
            return;
        }

        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
    }
}