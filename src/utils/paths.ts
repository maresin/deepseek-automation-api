// src/utils/paths.ts
/**
 * @file src/utils/paths.ts
 * File-system helpers for locating the bundled Chromium installation.
 *
 * The project keeps Chromium under ./browsers so that a checkout is
 * self-contained and does not depend on the global Playwright cache.
 * The exact subdirectory name differs by platform and by Playwright
 * version, so the resolver tries several well-known layouts.
 */

import path from 'path';
import fs from 'fs';

/**
 * Absolute path to the ./browsers directory at the project root.
 * Creates the directory if it does not exist.
 */
export function getBrowsersPath(): string {
    const moduleBrowsersPath = path.join(__dirname, '..', '..', 'browsers');

    if (!fs.existsSync(moduleBrowsersPath)) {
        fs.mkdirSync(moduleBrowsersPath, { recursive: true });
    }

    return moduleBrowsersPath;
}

/**
 * Locate the Chromium executable inside ./browsers.
 *
 * The directory name starts with "chromium-" and its content layout
 * depends on the platform:
 *   - win32   : chrome.exe at the root of the chromium-* directory
 *   - darwin  : chrome-mac/Chromium.app/Contents/MacOS/Chromium
 *   - linux   : one of chrome-linux64/chrome, chrome-linux/chrome, chrome
 *
 * @throws Error if Chromium is not present or the executable is missing.
 * @returns Absolute path to the Chromium executable.
 */
export function getChromiumExecutablePath(): string {
    const browsersPath = getBrowsersPath();

    const entries = fs.readdirSync(browsersPath);
    const chromiumDir = entries.find(e => e.startsWith('chromium-'));

    if (!chromiumDir) {
        throw new Error(`Chromium not found in ${browsersPath}`);
    }

    const chromiumPath = path.join(browsersPath, chromiumDir);

    const platform = process.platform;
    let executablePath: string = '';

    switch (platform) {
        case 'win32':
            executablePath = path.join(chromiumPath, 'chrome.exe');
            break;
        case 'darwin':
            executablePath = path.join(chromiumPath, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
            break;
        default:
            // Try the two Linux layouts used by Playwright across versions.
            const possiblePaths = [
                path.join(chromiumPath, 'chrome-linux64', 'chrome'),
                path.join(chromiumPath, 'chrome-linux', 'chrome'),
                path.join(chromiumPath, 'chrome'),
            ];

            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    executablePath = p;
                    break;
                }
            }
            break;
    }

    if (!executablePath || !fs.existsSync(executablePath)) {
        throw new Error(`Chrome executable not found in ${chromiumPath}`);
    }

    return executablePath;
}

/**
 * Absolute path to state.json, stored next to the ./browsers directory.
 */
export function getStatePath(): string {
    const browsersPath = getBrowsersPath();
    return path.join(browsersPath, '..', 'state.json');
}

/**
 * Export the browsers path through PLAYWRIGHT_BROWSERS_PATH so that
 * Playwright's own resolvers pick up the local installation.
 */
export function setupPlaywrightEnv(): void {
    const browsersPath = getBrowsersPath();
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
}