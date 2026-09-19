// src/features/FeatureToggles.ts
/**
 * @file src/features/FeatureToggles.ts
 * Controls the two persistent UI toggles in the DeepSeek chat:
 * DeepThink (R1) and Web Search.
 *
 * The toggles live in the input area and affect every subsequent message
 * until they are switched off. Each toggle is a button whose selected
 * state is reflected by the `ds-toggle-button--selected` class on the
 * button element itself (set by the DeepSeek design system). The class is
 * used instead of `aria-pressed` because it is present synchronously and
 * does not lag behind the visual state.
 */

import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

/**
 * Manages the DeepThink and Web Search toggles.
 */
export class FeatureToggles {
    /**
     * @param browserManager - Provides the active page.
     */
    constructor(private browserManager: BrowserManager) {}

    /**
     * Enable or disable DeepThink.
     *
     * If the toggle is missing from the current UI (for example, during
     * a page reload), the call is a no-op: the caller is expected to
     * retry on the next message.
     *
     * @param enabled - true to enable, false to disable.
     */
    async setDeepThink(enabled: boolean): Promise<void> {
        const page = this.browserManager.page;
        if (!page) return;

        const button = await page.$(Selectors.deepThinkButton);
        if (!button) {
            console.warn('⚠️ DeepThink button not found');
            return;
        }

        const isSelected = await button.evaluate((el) =>
            el.classList.contains('ds-toggle-button--selected')
        );

        if (enabled !== isSelected) {
            await button.click();
            await page.waitForTimeout(500);
            console.log(`🧠 DeepThink ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    /**
     * Enable or disable Web Search.
     *
     * The Search toggle is absent in Expert mode. Trying to enable it
     * there logs a warning and does nothing — the caller should either
     * accept this or switch to a mode where the toggle exists.
     *
     * @param enabled - true to enable, false to disable.
     */
    async setWebSearch(enabled: boolean): Promise<void> {
        const page = this.browserManager.page;
        if (!page) return;

        const button = await page.$(Selectors.webSearchButton);
        if (!button) {
            if (enabled) {
                console.warn('⚠️ WebSearch button not found – cannot enable');
            } else {
                console.log('ℹ️ WebSearch button not found – already disabled');
            }
            return;
        }

        const isSelected = await button.evaluate((el) =>
            el.classList.contains('ds-toggle-button--selected')
        );

        if (enabled !== isSelected) {
            await button.click();
            await page.waitForTimeout(500);
            console.log(`🌐 Web Search ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    /**
     * Check whether DeepThink is currently enabled.
     *
     * @returns true if the toggle is in the selected state.
     */
    async isDeepThinkEnabled(): Promise<boolean> {
        const page = this.browserManager.page;
        if (!page) return false;

        const button = await page.$(Selectors.deepThinkButton);
        if (!button) return false;

        return await button.evaluate((el) =>
            el.classList.contains('ds-toggle-button--selected')
        );
    }
}