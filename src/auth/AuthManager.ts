// src/auth/AuthManager.ts
import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

export class AuthManager {
    constructor(private browserManager: BrowserManager) {}

    async ensureAuthenticated(email?: string, password?: string): Promise<void> {
        const page = this.browserManager.page!;
        const hasChat = await page.$(Selectors.textarea);
        if (hasChat) {
            console.log('✅ Already logged in');
            return;
        }
        const currentUrl = page.url();
        if (currentUrl.includes(Selectors.signInPage)) {
            if (email && password) {
                await this.performAutoLogin(email, password);
            } else {
                console.log('👤 Manual login mode - waiting for user...');
                await page.waitForSelector(Selectors.textarea, { timeout: 120000 });
            }
        } else {
            await this.browserManager.goto('https://chat.deepseek.com/sign_in');
            await this.ensureAuthenticated(email, password);
        }
    }

    private async performAutoLogin(email: string, password: string): Promise<void> {
        const page = this.browserManager.page!;
        const emailInput = await page.$(Selectors.emailInput);
        if (emailInput) {
            await emailInput.fill(email);
            console.log('✓ Email filled');
        } else {
            console.log('⚠️ Email field not found');
        }
        const passwordInput = await page.$(Selectors.passwordInput);
        if (passwordInput) {
            await passwordInput.fill(password);
            console.log('✓ Password filled');
        } else {
            console.log('⚠️ Password field not found');
        }
        await page.waitForTimeout(500);
        const loginButton = await page.$(Selectors.loginButton) || await page.$(Selectors.loginButtonFallback);
        if (loginButton) {
            await loginButton.click();
            console.log('✓ Login button clicked');
        } else {
            throw new Error('Login button not found');
        }
        await page.waitForSelector(Selectors.textarea, { timeout: 30000 });
        console.log('✓ Auto-login successful');
    }
}