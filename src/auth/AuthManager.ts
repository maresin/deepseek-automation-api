// src/auth/AuthManager.ts
/**
 * @file src/auth/AuthManager.ts
 * Handles authentication against the DeepSeek sign-in page.
 *
 * The manager works on top of BrowserManager: it checks whether the
 * current page already shows the chat interface, and if not, either
 * performs an automatic login with the credentials from .env or waits
 * for a manual login from the user.
 */

import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

/**
 * Ensures that the browser session is authenticated.
 *
 * Resolution order:
 *   1. If the chat textarea is already visible — nothing to do.
 *   2. If on /sign_in:
 *      - with email and password — attempt automatic login;
 *      - without credentials — wait for manual login (up to 2 minutes).
 *   3. Otherwise — navigate to /sign_in and retry.
 */
export class AuthManager {
    /**
     * @param browserManager - Browser manager providing the active page.
     */
    constructor(private browserManager: BrowserManager) {}

    /**
     * Ensure the session is authenticated, logging in or waiting as needed.
     *
     * @param email    - DeepSeek account email. Optional.
     * @param password - DeepSeek account password. Optional.
     */
    async ensureAuthenticated(email?: string, password?: string): Promise<void> {
        const page = this.browserManager.page!;

        // Already logged in — chat textarea is present on the current page.
        const hasChat = await page.$(Selectors.mainTextarea);
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
                await page.waitForSelector(Selectors.mainTextarea, { timeout: 120000 });
            }
        } else {
            // We are somewhere else — go to the sign-in page first.
            await this.browserManager.goto('https://chat.deepseek.com/sign_in');
            await this.ensureAuthenticated(email, password);
        }
    }

    /**
     * Fill the login form and submit it, then wait for the chat UI.
     *
     * @param email    - DeepSeek account email.
     * @param password - DeepSeek account password.
     * @throws Error if the login button is missing, or the chat page does
     *               not appear within 30 seconds after submission.
     */
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

        // The primary selector requires the English "Log in" text; the
        // fallback matches the button by its design-system class alone.
        const loginButton = await page.$(Selectors.loginButton)
            || await page.$(Selectors.loginButtonFallback);
        if (loginButton) {
            await loginButton.click();
            console.log('✓ Login button clicked');
        } else {
            throw new Error('Login button not found');
        }

        await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
        console.log('✓ Auto-login successful');
    }
}