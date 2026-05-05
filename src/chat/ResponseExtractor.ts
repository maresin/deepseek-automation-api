// src/chat/ResponseExtractor.ts
import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

export class ResponseExtractor {
    constructor(private browserManager: BrowserManager) {}

    async getResponseViaCopyButton(): Promise<string> {
        const page = this.browserManager.page!;
        console.log('   📋 Trying copy button...');
        try {
            const result = await page.evaluate((selector) => {
                const allElements = Array.from(document.querySelectorAll('*'));
                const copyButtons: HTMLElement[] = [];
                for (const el of allElements) {
                    const svgPath = el.querySelector(selector);
                    if (svgPath) {
                        const button = el.closest('button, [role="button"]') as HTMLElement;
                        if (button) copyButtons.push(button);
                    }
                }
                if (copyButtons.length === 0) return null;
                const lastButton = copyButtons[copyButtons.length - 1];
                lastButton.click();
                return { success: true, count: copyButtons.length };
            }, Selectors.copyButtonPath);
            if (!result) return '';
            console.log(`   Found ${result.count} button(s), clicked last`);
            await page.waitForTimeout(1000);
            const clipboardText = await page.evaluate(() => {
                try { return navigator.clipboard.readText(); } catch(e) { return ''; }
            });
            if (clipboardText && clipboardText.length > 0) {
                console.log(`   ✅ Got ${clipboardText.length} chars`);
                return clipboardText;
            }
            return '';
        } catch (error) {
            console.log(`   Copy button failed: ${error}`);
            return '';
        }
    }

    async getResponseByKeyWithCopy(messageKey: number): Promise<string> {
        const page = this.browserManager.page!;
        const element = await page.$(`[data-virtual-list-item-key="${messageKey}"]`);
        if (!element) return '';
        const copyIcon = await element.waitForSelector(Selectors.copyButtonPath, { timeout: 60000 });
        if (!copyIcon) return '';
        const button = await copyIcon.evaluateHandle(path => path.closest('button, [role="button"]'));
        if (!button) return '';
        await button.evaluate((btn: HTMLElement) => btn.click());
        await page.waitForTimeout(1000);
        return await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    }

    async getResponseViaMarkdown(): Promise<string> {
        const page = this.browserManager.page!;
        console.log('   📝 Trying markdown parsing...');
        const markdown = await page.$('.ds-message:last-child .ds-markdown');
        if (markdown) {
            const text = await markdown.textContent();
            if (text && text.trim().length > 0) {
                console.log(`   ✅ Got ${text.length} chars via markdown`);
                return text.trim();
            }
        }
        return '';
    }
}