// src/utils/paths.ts
import path from 'path';
import fs from 'fs';

export function getBrowsersPath(): string {
    const moduleBrowsersPath = path.join(__dirname, '..', '..', 'browsers');
    
    if (!fs.existsSync(moduleBrowsersPath)) {
        fs.mkdirSync(moduleBrowsersPath, { recursive: true });
    }
    
    return moduleBrowsersPath;
}

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

export function getStatePath(): string {
    const browsersPath = getBrowsersPath();
    return path.join(browsersPath, '..', 'state.json');
}

export function setupPlaywrightEnv(): void {
    const browsersPath = getBrowsersPath();
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
}