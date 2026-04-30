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
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
        });
        this.context = await this.browser.newContext({
            viewport,
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            storageState,
            permissions: ['clipboard-read', 'clipboard-write']
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