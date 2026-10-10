// src/browser/BrowserManager.ts
/**
 * @file src/browser/BrowserManager.ts
 * Owns the Playwright browser lifecycle and the active page.
 *
 * The manager provides two behaviour patches that are essential for the
 * project:
 *
 *   1. Clipboard isolation. DeepSeek's "Copy" button writes into the
 *      browser clipboard. In a shared Chromium profile the read-back after
 *      a click could return stale content, so we replace `navigator.clipboard`
 *      with an in-page buffer that lives for the lifetime of the page.
 *
 *   2. Webdriver flag removal. DeepSeek checks `navigator.webdriver` and
 *      degrades the UI in an automated browser; the init script clears it.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { getChromiumExecutablePath } from '../utils/paths.js';
import fs from 'fs';

export class BrowserManager {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    public page: Page | null = null;

    /**
     * Launch a Chromium instance and open an initial page.
     *
     * @param headless     - Run Chromium without a visible window.
     * @param viewport     - Viewport size passed to the context.
     * @param storageState - Optional Playwright storage state (cookies, origins)
     *                       used to resume an authenticated session.
     */
    async launch(headless: boolean, viewport: any, storageState?: any): Promise<void> {
        const chromePath = getChromiumExecutablePath();
        this.browser = await chromium.launch({
            headless,
            executablePath: chromePath,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        this.context = await this.browser.newContext({
            viewport,
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            storageState,
            permissions: ['clipboard-read', 'clipboard-write'],
            // Force English at the protocol level. DeepSeek reads Accept-Language
            // to decide the UI language; without this, Playwright sends the
            // system locale (e.g. ru-RU), and every text-based selector in the
            // project fails. Setting locale + Accept-Language together makes the
            // sign-in page, chat UI, and system banners all render in English
            // from the very first request.
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        // Replace navigator.clipboard with an isolated in-page buffer.
        // The real clipboard is per-OS and shared between pages; using it
        // would let one request read what another request copied earlier.
        // The guard flag ensures the script runs only once per document.
        await this.context.addInitScript(() => {
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
                dispatchEvent() { return true; }
            };

            Object.defineProperty(navigator, 'clipboard', {
                value: fakeClipboard,
                writable: false,
                configurable: true
            });

            (window as any).__playwright_clipboard_isolated = true;
        });

        this.page = await this.context.newPage();

        // Hide the webdriver flag: DeepSeek inspects it and, when set,
        // serves a degraded chat interface that breaks selectors.
        await this.page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
    }

    /**
     * Navigate the active page to a URL and wait for the load event.
     *
     * @param url - Target URL.
     */
    async goto(url: string): Promise<void> {
        await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page!.waitForTimeout(500);
    }

    /**
     * Persist the browser storage state to disk.
     *
     * Two safeguards against concurrent writers (relevant when two
     * agents share a single DEEPSEEK_STATE_PATH):
     *
     *   1. mtime guard. If `loadedAtMs` is non-zero and the file's
     *      mtime is newer than that value, another process wrote a
     *      fresher copy after we read ours. Skip the write rather
     *      than clobber it.
     *
     *   2. Atomic replace. Write to `<path>.tmp`, then rename. On
     *      POSIX and NTFS rename is atomic, so a concurrent reader
     *      never observes a half-written file.
     *
     * Callers that intentionally produce the freshest possible state
     * (the login flow) pass `loadedAtMs = 0` to force the write.
     *
     * @param statePath   - Path to state.json.
     * @param loadedAtMs  - mtime observed when the state was read.
     *                      0 means "unconditional write".
     * @returns true if the state was written, false if skipped.
     */
    async saveState(statePath: string, loadedAtMs: number = 0): Promise<boolean> {
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
                // File disappeared between read and write — safe to write.
            }
        }

        const state = await this.context.storageState();
        const tmp = statePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, statePath);
        console.log(`💾 State saved (${state.cookies?.length || 0} cookies)`);
        return true;
    }

    /**
     * Load a previously saved browser storage state, if the file exists.
     *
     * @param statePath - Path to the state.json file.
     * @returns The parsed storage state, or undefined if the file is absent.
     */
    async loadState(statePath: string): Promise<any> {
        if (fs.existsSync(statePath)) {
            return JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }
        return undefined;
    }

    /**
     * Close the context and the browser. Safe to call multiple times.
     */
    async close(): Promise<void> {
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
    }
}