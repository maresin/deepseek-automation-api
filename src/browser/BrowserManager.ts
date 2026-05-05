// src/browser/BrowserManager.ts
import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { getChromiumExecutablePath } from '../utils/paths.js';
import fs from 'fs';

export class BrowserManager {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    public page: Page | null = null;

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
            permissions: ['clipboard-read', 'clipboard-write']
        });

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
        await this.page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
    }

    async goto(url: string): Promise<void> {
        await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page!.waitForTimeout(500);
    }

    async saveState(statePath: string): Promise<void> {
        if (!this.context) return;
        const state = await this.context.storageState();
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        console.log(`💾 State saved (${state.cookies?.length || 0} cookies)`);
    }

    async loadState(statePath: string): Promise<any> {
        if (fs.existsSync(statePath)) {
            return JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }
        return undefined;
    }

    async close(): Promise<void> {
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
    }
}