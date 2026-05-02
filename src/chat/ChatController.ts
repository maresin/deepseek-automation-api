import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

export class ChatController {
    constructor(private browserManager: BrowserManager) {}

    async clearInput(): Promise<void> {
        const page = this.browserManager.page!;
        await page.click(Selectors.textarea);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
    }

    async typeMessage(message: string): Promise<void> {
        const page = this.browserManager.page!;
        await page.click(Selectors.textarea);
        if (message.length <= 50) {
            // Короткие сообщения вводим посимвольно (опционально)
            for (const char of message) {
                await page.keyboard.type(char);
                await page.waitForTimeout(50);
            }
        } else {
            // Длинные сообщения: прямая вставка без буфера обмена
            await page.keyboard.insertText(message);
            await page.waitForTimeout(200);
        }
    }

    async send(): Promise<void> {
        const page = this.browserManager.page!;
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        const textAfterEnter = await page.inputValue(Selectors.textarea).catch(() => '');
        if (textAfterEnter && textAfterEnter.length > 0) {
            const sendButton = await page.$(Selectors.sendButton);
            if (sendButton) {
                await sendButton.click();
                console.log('   Clicked send button as fallback');
            }
        }
    }

    async attachFile(filePath: string): Promise<void> {
        const page = this.browserManager.page!;
        const uploadButton = await page.$(Selectors.uploadButton);
        if (!uploadButton) throw new Error('Upload button not found');
        await uploadButton.click();
        await page.waitForTimeout(1000);
        const fileInput = await page.$(Selectors.fileInput);
        if (!fileInput) throw new Error('File input not found');
        await fileInput.setInputFiles(filePath);
        try {
            await page.waitForSelector('.ds-loading', { timeout: 5000 });
            await page.waitForSelector('.ds-loading', { state: 'hidden', timeout: 60000 });
        } catch { }
        await page.waitForSelector(Selectors.sendButton, { timeout: 10000 });
        await page.click(Selectors.textarea);
        await page.waitForTimeout(500);
        console.log(`   ✅ File attached and loaded`);
    }

    async removeSelectedFile(): Promise<void> {
        const page = this.browserManager.page!;
        const deleteIcon = await page.$(Selectors.deleteFileIcon);
        if (!deleteIcon) return;
        const button = await deleteIcon.evaluateHandle(path => path.closest('button, div[role="button"], div[tabindex="0"]'));
        if (!button) return;
        await button.evaluate((btn: HTMLElement) => btn.click());
        await page.waitForTimeout(500);
        console.log('✅ Selected file removed');
    }

    async waitForTempNewChatButton(timeoutMs: number = 10000): Promise<boolean> {
        const page = this.browserManager.page!;
        try {
            await page.waitForSelector(Selectors.tempNewChatButton, { timeout: timeoutMs });
            return true;
        } catch {
            return false;
        }
    }

    async waitForResponseComplete(timeoutMs: number = 300000): Promise<void> {
        const page = this.browserManager.page!;
        console.log('   Waiting for response completion (tracking arrow)...');
        const arrowIcon = Selectors.arrowIconPath;
        let arrowDisappeared = false;
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const hasArrow = await page.evaluate((icon) => document.body.innerHTML.includes(icon), arrowIcon);
            if (!hasArrow && !arrowDisappeared) {
                arrowDisappeared = true;
                console.log('   Arrow disappeared - response generation started');
            } else if (hasArrow && arrowDisappeared) {
                console.log('   Arrow returned - response complete');
                await page.waitForTimeout(2000);
                return;
            }
            await page.waitForTimeout(1000);
        }
        console.log('   Timeout waiting for response completion');
    }

    async waitForAssistantMessage(lastKey: number, timeoutMs: number = 600000): Promise<void> {
        const page = this.browserManager.page!;
        const targetKey = lastKey + 2;
        console.log(`   Waiting for assistant message with key ${targetKey}...`);
        try {
            await page.waitForSelector(`[data-virtual-list-item-key="${targetKey}"]`, { timeout: timeoutMs });
            console.log(`   ✅ Assistant message with key ${targetKey} appeared`);
            await page.waitForTimeout(500);
        } catch (err) {
            console.log(`   Key ${targetKey} not found, using fallback detection...`);
            const initialCount = await page.$$eval(Selectors.virtualListItem, els => els.length);
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const currentCount = await page.$$eval(Selectors.virtualListItem, els => els.length);
                if (currentCount > initialCount) {
                    console.log(`   ✅ New message detected (count increased from ${initialCount} to ${currentCount})`);
                    await page.waitForTimeout(1000);
                    return;
                }
                await page.waitForTimeout(1000);
            }
            throw new Error(`Timeout waiting for assistant message (lastKey=${lastKey})`);
        }
    }

    async newChat(): Promise<void> {
        const page = this.browserManager.page!;
        let button = await page.$(Selectors.permanentNewChatButton);
        if (!button) button = await page.$(Selectors.permanentNewChatButtonFallback);
        if (!button) {
            const messages = await page.$$(Selectors.virtualListItem);
            if (messages.length === 0) {
                console.log('Chat is already empty, skipping new chat creation');
                return;
            }
            throw new Error('New chat button not found');
        }
        await button.evaluate((btn: HTMLElement) => btn.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await page.waitForTimeout(500);
        await button.click();
        await page.waitForSelector(Selectors.textarea, { timeout: 30000 });
        console.log('✅ New chat created');
    }

    async isNewChatButtonPresent(): Promise<boolean> {
        const page = this.browserManager.page!;
        const btn = await page.$('button:has-text("New chat"), button:has-text("Новый чат")');
        return btn !== null;
    }
}