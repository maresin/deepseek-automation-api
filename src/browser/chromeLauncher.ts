// src/browser/chromeLauncher.ts
/**
 * @file src/browser/chromeLauncher.ts
 * Chooses between the bundled Chromium and the system Google Chrome.
 *
 * The bundled Chromium (installed under ./browsers by
 * `npx playwright install chromium`) is the default: it is
 * self-contained, versioned with the project, and needs no extra
 * setup. It is also the most likely build to be fingerprinted by
 * Cloudflare as "automated", which matters when DeepSeek's login
 * page is the first page an agent visits.
 *
 * The system Google Chrome is a fallback for cases where the bundled
 * Chromium cannot pass Cloudflare's challenge. Chrome carries a
 * different fingerprint and is often treated more favourably. It
 * must be installed separately (via apt, .deb, or the official
 * installer) and is discovered by Playwright via the "chrome"
 * channel — no path is needed.
 *
 * Selection is controlled by DEEPSEEK_BROWSER:
 *   - "chromium" (default): bundled Chromium from ./browsers
 *   - "chrome":             system Google Chrome (channel="chrome")
 *
 * No fallback is attempted. If DEEPSEEK_BROWSER=chrome is set and
 * the system Chrome is not installed, Playwright raises an error
 * with the expected search paths. Silently falling back would mask
 * the fact that the user's explicit choice was ignored.
 */

import { getChromiumExecutablePath } from '../utils/paths.js';

export type BrowserChoice = 'chromium' | 'chrome';

export interface ChromeLaunchOptions {
    /** Playwright channel — present only for system Chrome. */
    channel?: 'chrome';
    /** Executable path — present only for bundled Chromium. */
    executablePath?: string;
}

/**
 * Read DEEPSEEK_BROWSER and normalize it.
 *
 * Unknown values fall back to "chromium" with a warning: a typo in
 * the env var should not silently change behaviour, but it also
 * should not break the server on startup.
 */
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

/**
 * Return launch options suitable for chromium.launch(...).
 *
 * The caller spreads them into its own options:
 *
 *     const opts = getChromeLaunchOptions();
 *     await chromium.launch({ headless, ...opts, args: [...] });
 *
 * For "chromium": returns { executablePath }, resolved from ./browsers.
 *                  Throws if bundled Chromium is missing.
 * For "chrome":   returns { channel: 'chrome' }. Playwright resolves
 *                  the path from standard install locations; it raises
 *                  at launch time if Chrome is not found.
 */
export function getChromeLaunchOptions(): ChromeLaunchOptions {
    if (getBrowserChoice() === 'chrome') {
        return { channel: 'chrome' };
    }
    return { executablePath: getChromiumExecutablePath() };
}

/**
 * Human-readable label for logs.
 */
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