// src/features/FeatureToggles.ts
import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

export class FeatureToggles {
    constructor(
        private browserManager: BrowserManager,
        private isChatStarted: () => boolean
    ) {}

    async setDeepThink(enabled: boolean): Promise<void> {
        const page = this.browserManager.page;
        if (!page) return;
        const button = await page.$(Selectors.deepThinkButton);
        if (!button) {
            console.warn('DeepThink button not found');
            return;
        }
        const isSelected = await button.evaluate((el) => el.classList.contains('ds-toggle-button--selected'));
        if (enabled !== isSelected) {
            await button.click();
            await page.waitForTimeout(500);
            console.log(`🧠 DeepThink ${enabled ? 'enabled' : 'disabled'}`);
        } else {
            console.log(`ℹ️ DeepThink already ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    async setWebSearch(enabled: boolean): Promise<void> {
        const page = this.browserManager.page;
        if (!page) return;
        const button = await page.$(Selectors.webSearchButton);
        if (!button) {
            console.warn('WebSearch button not found');
            return;
        }
        const isSelected = await button.evaluate((el) => el.classList.contains('ds-toggle-button--selected'));
        if (enabled !== isSelected) {
            await button.click();
            await page.waitForTimeout(500);
            console.log(`🌐 Web Search ${enabled ? 'enabled' : 'disabled'}`);
        } else {
            console.log(`ℹ️ Web Search already ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    async setExpertMode(enabled: boolean): Promise<void> {
        if (this.isChatStarted()) {
            console.warn('⚠️ Expert/Instant mode cannot be changed after the first message (system or user)');
            return;
        }
        const page = this.browserManager.page;
        if (!page) return;
        const targetRadio = enabled 
            ? await page.$(Selectors.expertModeRadio) 
            : await page.$(Selectors.instantModeRadio);
        if (!targetRadio) {
            console.warn(`Radio button for ${enabled ? 'Expert' : 'Instant'} not found`);
            return;
        }
        const isChecked = await targetRadio.getAttribute('aria-checked');
        if (isChecked === 'true') {
            console.log(`ℹ️ Already in ${enabled ? 'Expert' : 'Instant'} mode`);
            return;
        }
        console.log(`🔄 Switching to ${enabled ? 'Expert' : 'Instant'} mode...`);
        await targetRadio.click();
        console.log(`⏳ Waiting 5 seconds for visual confirmation...`);
        await page.waitForTimeout(5000);
        console.log(`✅ Mode switched to ${enabled ? 'Expert' : 'Instant'}`);
    }

    async getCurrentMode(): Promise<'expert' | 'instant' | null> {
        const page = this.browserManager.page;
        if (!page) return null;
        const indicator = await page.$(Selectors.modeIndicatorText);
        if (indicator) {
            const text = await indicator.textContent();
            if (text && (text.includes('Эксперт') || text.includes('Expert'))) return 'expert';
            if (text && (text.includes('Быстрый') || text.includes('Instant'))) return 'instant';
        }
        const expertRadio = await page.$(Selectors.expertModeRadio);
        if (expertRadio) {
            const isChecked = await expertRadio.getAttribute('aria-checked');
            return isChecked === 'true' ? 'expert' : 'instant';
        }
        return null;
    }
    async isDeepThinkEnabled(): Promise<boolean> {
        const page = this.browserManager.page;
        if (!page) return false;
        const button = await page.$(Selectors.deepThinkButton);
        if (!button) return false;
        return await button.evaluate((el) => el.classList.contains('ds-toggle-button--selected'));
    }
}