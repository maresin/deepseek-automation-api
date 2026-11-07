// src/browser/chromeLauncher.ts
/**
 * @file src/browser/chromeLauncher.ts
 * Chooses between bundled Chromium and system Google Chrome for
 * the auto-launch (stateless) path.
 *
 * In CDP mode this module is not consulted: the browser is already
 * running, launched by the user, and its binary is not our concern.
 *
 *   DEEPSEEK_BROWSER=chromium (default) → bundled under ./browsers
 *   DEEPSEEK_BROWSER=chrome              → system Google Chrome
 *
 * No fallback: if "chrome" is set and Chrome is not installed,
 * Playwright raises an error listing expected paths. Silently
 * falling back to Chromium would mask that the user's choice
 * was ignored.
 */

import { getChromiumExecutablePath } from '../utils/paths.js';

export type BrowserChoice = 'chromium' | 'chrome';

export interface ChromeLaunchOptions {
    channel?: 'chrome';
    executablePath?: string;
}

export function getBrowserChoice(): BrowserChoice {
    const raw = (process.env.DEEPSEEK_BROWSER || 'chromium').trim().toLowerCase();
    if (raw === 'chrome' || raw === 'system' || raw === 'system-chrome') {
        return 'chrome';
    }
    if (raw === 'chromium' || raw === 'bundled' || raw === 'default' || raw === '') {
        return 'chromium';
    }
    console.warn(
        `⚠️ Unknown DEEPSEEK_BROWSER="${process.env.DEEPSEEK_BROWSER}", ` +
        `falling back to "chromium". Valid values: "chromium", "chrome".`
    );
    return 'chromium';
}

export function getChromeLaunchOptions(): ChromeLaunchOptions {
    if (getBrowserChoice() === 'chrome') {
        return { channel: 'chrome' };
    }
    return { executablePath: getChromiumExecutablePath() };
}

export function describeBrowserChoice(): string {
    if (getBrowserChoice() === 'chrome') {
        return 'system Chrome (channel="chrome")';
    }
    try {
        return `bundled Chromium (${getChromiumExecutablePath()})`;
    } catch {
        return 'bundled Chromium';
    }
}