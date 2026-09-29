// src/auth/AuthManager.ts
/**
 * @file src/auth/AuthManager.ts
 * Handles authentication against the DeepSeek sign-in page.
 *
 * The manager works on top of BrowserManager: it checks whether the
 * current page already shows the chat interface, and if not, either
 * performs an automatic login with the credentials from .env or waits
 * for a manual login from the user.
 *
 * The sign-in page renders asynchronously and performs client-side
 * navigation after form submission. Both `ensureAuthenticated` and
 * `performAutoLogin` must therefore wait for the DOM to settle before
 * issuing any `page.$()` query — otherwise Playwright throws
 * "Execution context was destroyed, most likely because of a
 * navigation" and the login aborts.
 */

import { BrowserManager } from '../browser/BrowserManager.js';
import { Selectors } from '../browser/Selectors.js';

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

        // DeepSeek's sign-in page performs a client-side redirect after
        // DOMContentLoaded. A page.$() call issued during that transition
        // throws "Execution context was destroyed". Wait for the network
        // to settle, then retry the presence check a few times.
        try {
            await page.waitForLoadState('networkidle', { timeout: 15000 });
        } catch { /* proceed with whatever state we have */ }

        let hasChat = false;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                hasChat = (await page.$(Selectors.mainTextarea)) !== null;
                break;
            } catch (err) {
                const msg = (err as Error).message || '';
                if (!msg.includes('Execution context was destroyed')) {
                    if (attempt >= 2) throw err;
                }
                await page.waitForTimeout(1000);
            }
        }

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
     * The form is rendered asynchronously after page load. Probing with
     * page.$() too early returns null; clicking Login on an empty form
     * triggers a client-side navigation, which in turn destroys the
     * execution context mid-query.
     *
     * Strategy:
     *   1. Wait for the network to settle.
     *   2. Wait for the first input element to appear — form is ready.
     *   3. Probe email/password with retry on context-destroyed errors.
     *   4. Fill, submit, wait for the chat textarea.
     *
     * @param email    - DeepSeek account email.
     * @param password - DeepSeek account password.
     */
    private async performAutoLogin(email: string, password: string): Promise<void> {
        const page = this.browserManager.page!;

        // 1. Let the page finish any pending navigations.
        try {
            await page.waitForLoadState('networkidle', { timeout: 15000 });
        } catch { /* proceed anyway */ }

        // 2. Wait for the form to actually render. Any input with the
        //    design-system class is enough.
        try {
            await page.waitForSelector('input.ds-input__input', { timeout: 20000 });
        } catch {
            throw new Error('Sign-in form did not render within 20s');
        }

        // 3. A late navigation can still destroy the execution context
        //    between waitForSelector and page.$(). Retry on that specific
        //    error, up to 5 times.
        const safeQuery = async (sel: string) => {
            for (let attempt = 0; attempt < 5; attempt++) {
                try {
                    return await page.$(sel);
                } catch (err) {
                    const msg = (err as Error).message || '';
                    if (!msg.includes('Execution context was destroyed')) throw err;
                    await page.waitForTimeout(500);
                }
            }
            return null;
        };

        const emailInput = await safeQuery(Selectors.emailInput);
        if (!emailInput) {
            throw new Error('Email field not found after form render');
        }
        await emailInput.fill(email);
        console.log('✓ Email filled');

        const passwordInput = await safeQuery(Selectors.passwordInput);
        if (!passwordInput) {
            throw new Error('Password field not found after form render');
        }
        await passwordInput.fill(password);
        console.log('✓ Password filled');

        await page.waitForTimeout(500);

        // 4. Login button — class-based selector, locale-independent.
        //    The fallback is identical to the primary in current
        //    Selectors.ts, but kept for forward compatibility.
        const loginButton = await safeQuery(Selectors.loginButton)
            || await safeQuery(Selectors.loginButtonFallback);
        if (!loginButton) {
            throw new Error('Login button not found');
        }
        await loginButton.click();
        console.log('✓ Login button clicked');

        // 5. Wait for the chat textarea. mainTextarea is locale-independent
        //    (class + name="search").
        await page.waitForSelector(Selectors.mainTextarea, { timeout: 30000 });
        console.log('✓ Auto-login successful');
    }
}