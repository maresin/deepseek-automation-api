// src/chat/SessionRestorer.ts
import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

export class SessionRestorer {
    constructor(private browserManager: BrowserManager) {}

    async restoreLastChat(): Promise<boolean> {
        const page = this.browserManager.page!;
        const sessionLinks = await page.$$(Selectors.chatHistoryLink);
        if (sessionLinks.length === 0) {
            console.log('No previous sessions found');
            return false;
        }
        await sessionLinks[0].click();
        await page.waitForSelector(Selectors.textarea, { timeout: 30000 });
        console.log('Restored last chat from history');
        return true;
    }
}