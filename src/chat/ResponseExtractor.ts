// src/chat/ResponseExtractor.ts
/**
 * @file src/chat/ResponseExtractor.ts
 * Extracts assistant responses from the DeepSeek UI.
 * Detects DeepSeek internal length limit warnings.
 */

import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

const MAX_COPY_DEPTH = 3;

export class ResponseExtractor {
    constructor(private browserManager: BrowserManager) {}

    /**
     * Quick global check for the "Length limit reached ..." banner.
     * Uses textContent (not innerText) to avoid triggering layout.
     * @returns the matched banner text, or null.
     */
    async detectBanner(): Promise<string | null> {
        const page = this.browserManager.page!;
        return await page.evaluate((pattern: string) => {
            const re = new RegExp(pattern, 'i');
            const text = document.body.textContent || '';
            const m = text.match(re);
            return m ? m[0] : null;
        }, Selectors.lengthLimitBannerPattern.source);
    }

    /**
     * Scoped detection of the length limit warning inside a specific message block.
     * @returns { detected, percent, formulation }
     */
    async detectLengthLimit(messageKey?: number): Promise<{
        detected: boolean;
        percent: number | null;
        formulation: string | null;
    }> {
        const page = this.browserManager.page!;
        return await page.evaluate((cfg) => {
            let scope: Element | Document = document;
            if (cfg.key !== null) {
                const msgEl = document.querySelector(`[data-virtual-list-item-key="${cfg.key}"]`);
                if (msgEl) scope = msgEl;
            }
            const text = (scope as Element).textContent || '';
            const re = new RegExp(cfg.pattern, 'i');
            const m = text.match(re);
            if (!m) return { detected: false, percent: null, formulation: null };

            const formulation = m[0];
            const percentMatch = formulation.match(/first\s+(\d+)%/i);
            const percent = percentMatch ? parseInt(percentMatch[1], 10) : null;
            return { detected: true, percent, formulation };
        }, {
            key: messageKey === undefined ? null : messageKey,
            pattern: Selectors.lengthLimitBannerPattern.source,
        });
    }

    /**
     * Detect the "Server busy, please try again later." placeholder.
     *
     * DeepSeek renders this as a system item in the message list when its
     * backend refuses to answer. The placeholder contains a Retry button
     * and produces an empty Copy result — which is exactly the reason this
     * detection is called only after an empty response has been received.
     *
     * Two independent signals are checked inside each data-virtual-list-item-key
     * block, and either is sufficient:
     *   1. Retry icon SVG path prefix (primary, localization-safe).
     *   2. Exact text match on the warning span (fallback).
     *
     * Combined detection avoids false positives from user-authored text:
     * the placeholder block contains a Retry button, while a normal message
     * block never does.
     *
     * @returns true if the placeholder is present in the DOM.
     */
    async detectServerBusy(): Promise<boolean> {
        const page = this.browserManager.page!;
        return await page.evaluate((cfg) => {
            const blocks = document.querySelectorAll('[data-virtual-list-item-key]');
            for (const block of Array.from(blocks)) {
                const paths = block.querySelectorAll('svg path');
                for (const p of Array.from(paths)) {
                    const d = p.getAttribute('d') || '';
                    if (d.startsWith(cfg.retryPath)) return true;
                }
                const spans = block.querySelectorAll('span');
                for (const s of Array.from(spans)) {
                    if ((s.textContent || '').trim() === cfg.busyText) return true;
                }
            }
            return false;
        }, {
            retryPath: Selectors.retryButtonPathPrefix,
            busyText: Selectors.serverBusyText,
        });
    }

    /**
     * Check whether the Continue button is present inside the given message block.
     * Presence does not require visibility — the button may be off-screen.
     */
    async hasContinueButton(messageKey: number): Promise<boolean> {
        const page = this.browserManager.page!;
        return await page.evaluate((cfg) => {
            const block = document.querySelector(`[data-virtual-list-item-key="${cfg.key}"]`);
            if (!block) return false;
            const btns = Array.from(block.querySelectorAll('[role="button"]'));
            return btns.some(b => (b.textContent || '').trim() === cfg.label);
        }, { key: messageKey, label: Selectors.continueButtonText });
    }

    /**
     * Find the footer Copy button inside the given message block.
     * Footer Copy is distinguished from code-block Copy by walking up the DOM:
     * within `maxDepth` ancestors we must find a button whose SVG path starts
     * with the Regenerate prefix. Regenerate exists only in the assistant footer.
     *
     * @returns { ok, text?, depth?, reason? }
     */
    async getCopyTextByKeyWithRegenerate(
        messageKey: number,
        maxDepth: number = MAX_COPY_DEPTH
    ): Promise<{ ok: boolean; text?: string; depth?: number; reason?: string }> {
        const page = this.browserManager.page!;

        const clicked = await page.evaluate((cfg) => {
            const block = document.querySelector(`[data-virtual-list-item-key="${cfg.key}"]`);
            if (!block) return { ok: false, reason: 'block not found' };

            const pathOf = (el: Element): string => {
                const p = el.querySelector('svg path');
                return p ? (p.getAttribute('d') || '') : '';
            };
            const buttonsIn = (root: Element): Element[] =>
                Array.from(root.querySelectorAll('[role="button"]'));

            const copies = buttonsIn(block).filter(
                el => pathOf(el).startsWith(cfg.copy)
            );

            for (const c of copies) {
                let node: Element | null = c.parentElement;
                let depth = 0;
                while (node && depth <= cfg.maxDepth) {
                    const hasRegen = buttonsIn(node).some(
                        el => pathOf(el).startsWith(cfg.regenerate)
                    );
                    if (hasRegen) {
                        (c as HTMLElement).click();
                        return { ok: true, depth };
                    }
                    node = node.parentElement;
                    depth++;
                }
            }
            return { ok: false, reason: 'no footer copy found' };
        }, {
            key: messageKey,
            copy: Selectors.copyButtonPathPrefix,
            regenerate: Selectors.regenerateButtonPathPrefix,
            maxDepth,
        });

        if (!clicked.ok) return { ok: false, reason: clicked.reason };

        await page.waitForTimeout(600);
        const text = await page.evaluate(() =>
            navigator.clipboard.readText().catch(() => '')
        );
        return { ok: true, text, depth: clicked.depth };
    }

    /**
     * Fallback extraction that reads the markdown body of a message
     * directly from the DOM, bypassing the Copy button.
     *
     * The previous implementation relied on a CSS selector with
     * :last-child, which is fragile: DeepSeek can insert non-message
     * elements between items, breaking the "last child" assumption.
     * This version locates the message block by its data attribute and
     * reads .ds-markdown inside it.
     *
     * Used when the Copy click fails — for example, if DeepSeek changes
     * the Copy icon and getCopyTextByKeyWithRegenerate can no longer find
     * a real footer Copy button.
     *
     * @param messageKey - data-virtual-list-item-key of the target message.
     *                     If omitted, the very last message block is used.
     * @returns Markdown text, or an empty string if no block/body is found.
     */
    async getResponseViaMarkdown(messageKey?: number): Promise<string> {
        const page = this.browserManager.page!;
        return await page.evaluate((cfg) => {
            let block: Element | null;
            if (cfg.key !== null) {
                block = document.querySelector(`[data-virtual-list-item-key="${cfg.key}"]`);
            } else {
                const items = document.querySelectorAll('[data-virtual-list-item-key]');
                block = items.length ? items[items.length - 1] : null;
            }
            if (!block) return '';
            const markdown = block.querySelector(cfg.bodySelector);
            if (!markdown) return '';
            return (markdown.textContent || '').trim();
        }, {
            key: messageKey === undefined ? null : messageKey,
            bodySelector: Selectors.markdownBodyRelative,
        });
    }
}