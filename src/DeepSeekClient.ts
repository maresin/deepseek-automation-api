// src/DeepSeekClient.ts
/// <reference types="node" />

import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import {
    DeepSeekConfig,
    DeepSeekFeatures,
    DeepSeekResponse,
    DeepSeekError,
    SendMessageOptions
} from './types.js';
import { getBrowsersPath, getChromiumExecutablePath, setupPlaywrightEnv } from './utils/paths.js';

export type StrategyType = 'copy-button' | 'parsing' | 'auto';

export class DeepSeekClient {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    public page: Page | null = null;
    private config: Required<DeepSeekConfig>;
    private isInitialized: boolean = false;
    private strategy: StrategyType;
    private email?: string;
    private password?: string;
    private restoreSession: boolean;

    constructor(config: DeepSeekConfig & { 
        strategy?: StrategyType;
        email?: string;
        password?: string;
        restoreSession?: boolean;
    } = {}) {
        setupPlaywrightEnv();
        this.config = {
            headless: false,
            showBrowser: true,
            viewport: { width: 1280, height: 800 },
            statePath: '',
            ...config
        };
        this.strategy = config.strategy || 'auto';
        this.email = config.email;
        this.password = config.password;
        this.restoreSession = config.restoreSession || false;
        console.log(`🎯 Using strategy: ${this.strategy}`);
        console.log(`🔄 Restore session on startup: ${this.restoreSession}`);
        if (this.config.statePath) {
            console.log(`💾 State path: ${this.config.statePath}`);
        }
        if (this.email) {
            console.log(`🔐 Auto-login will be attempted for: ${this.email}`);
        }
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            const savedState = await this.loadState();
            let isAuthenticated = false;
            if (savedState && savedState.cookies) {
                const now = Date.now() / 1000;
                const validCookies = savedState.cookies.filter((cookie: any) => {
                    return !cookie.expires || cookie.expires > now;
                });
                isAuthenticated = validCookies.length > 0;
                console.log(`📊 Found ${savedState.cookies.length} cookies, ${validCookies.length} valid`);
            }
            
            const chromePath = getChromiumExecutablePath();
            console.log(`🔧 Launching Chrome from: ${chromePath}`);
            
            this.browser = await chromium.launch({
                headless: this.config.headless,
                executablePath: chromePath,
                args: [
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=ChromeWhatsNewUI',
                    '--disable-infobars',
                    ...(this.config.headless ? ['--disable-gpu'] : [])
                ]
            });

            this.context = await this.browser.newContext({
                viewport: this.config.viewport,
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                storageState: isAuthenticated ? savedState : undefined,
                permissions: ['clipboard-read', 'clipboard-write']
            });

            this.page = await this.context.newPage();
            
            await this.page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            });
            
            if (isAuthenticated) {
                console.log('📱 Restoring existing session, going to main page');
                await this.page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.page.waitForTimeout(3000);
                
                // Restore previous session from history if requested
                if (this.restoreSession) {
                    await this.restorePreviousSession();
                }
            } else {
                console.log('🔐 No valid session found, going directly to sign in page');
                await this.page.goto('https://chat.deepseek.com/sign_in', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.page.waitForTimeout(3000);
                await this.ensureAuthenticated();
            }
            
            this.isInitialized = true;
            console.log('✅ DeepSeek client ready!');

        } catch (error) {
            throw new DeepSeekError(`Initialization failed: ${error}`, 'INIT_ERROR');
        }
    }

    // Restore previous session from DeepSeek history sidebar
    async restorePreviousSession(): Promise<boolean> {
        if (!this.page) return false;
        
        console.log('🔄 Attempting to restore previous session from history...');
        
        try {
            // Find all session links by href pattern (stable)
            const sessionLinks = await this.page.$$('a[href^="/a/chat/s/"]');
            
            if (sessionLinks.length === 0) {
                console.log('   No previous sessions found');
                return false;
            }
            
            // Click the first one (most recent - appears at top of sidebar)
            console.log(`   Found ${sessionLinks.length} session(s), clicking most recent`);
            await sessionLinks[0].click();
            await this.page.waitForTimeout(3000);
            
            await this.page.waitForSelector('textarea', { timeout: 30000 });
            console.log('✅ Previous session restored successfully');
            return true;
            
        } catch (error) {
            console.log(`   Failed to restore session: ${error}`);
            return false;
        }
    }

    private async ensureAuthenticated(): Promise<void> {
        if (!this.page) return;
        
        const hasChat = await this.page.$('textarea');
        if (hasChat) {
            console.log('✅ Already logged in');
            await this.saveState();
            return;
        }
        
        const isSignInPage = this.page.url().includes('/sign_in');
        
        if (isSignInPage) {
            if (this.email && this.password) {
                console.log('🤖 Auto-login mode - filling credentials...');
                await this.performAutoLogin();
            } else {
                console.log('👤 Manual login mode - waiting for user...');
                console.log('   Please log in manually in the browser window');
                await this.page.waitForSelector('textarea', { timeout: 120000 });
            }
            await this.saveState();
            console.log('✅ Authentication saved');
        }
    }

    private async performAutoLogin(): Promise<void> {
        if (!this.page) return;
        
        const emailInput = await this.page.$(
            'input[placeholder="Номер телефона / адрес электронной почты"], ' +
            'input[placeholder="Phone number / email address"]'
        );
        
        if (emailInput && this.email) {
            await emailInput.click();
            await emailInput.fill(this.email);
            console.log('✓ Email filled');
        } else {
            console.log('⚠️ Email field not found');
        }
        
        const passwordInput = await this.page.$(
            'input[placeholder="Пароль"], ' +
            'input[placeholder="Password"]'
        );
        
        if (passwordInput && this.password) {
            await passwordInput.click();
            await passwordInput.fill(this.password);
            console.log('✓ Password filled');
        } else {
            console.log('⚠️ Password field not found');
        }
        
        await this.page.waitForTimeout(500);
        
        const loginButton = await this.page.$(
            'button:has-text("Войти"), ' +
            'button:has-text("Log in")'
        );
        
        if (loginButton) {
            await loginButton.click();
            console.log('✓ Login button clicked');
        } else {
            const buttonByClass = await this.page.$('.ds-basic-button--primary');
            if (buttonByClass) {
                await buttonByClass.click();
                console.log('✓ Login button clicked (by class)');
            }
        }
        
        await this.page.waitForSelector('textarea', { timeout: 30000 });
        console.log('✓ Auto-login successful');
    }

    private async waitForResponseComplete(): Promise<void> {
        if (!this.page) return;
        
        console.log('   Waiting for response (tracking arrow button)...');
        
        let arrowDisappeared = false;
        for (let i = 0; i < 15; i++) {
            await this.page.waitForTimeout(2000);
            const hasArrow = await this.page.evaluate(() => {
                const html = document.body.innerHTML;
                return html.includes('M8.3125 0.981587');
            });
            if (!hasArrow) {
                arrowDisappeared = true;
                console.log(`   Arrow disappeared at ${(i+1)*2}s - response started`);
                break;
            }
        }
        
        if (!arrowDisappeared) {
            console.log('   Arrow never disappeared, continuing');
            return;
        }
        
        for (let i = 0; i < 6; i++) {
            await this.page.waitForTimeout(10000);
            const hasArrow = await this.page.evaluate(() => {
                const html = document.body.innerHTML;
                return html.includes('M8.3125 0.981587');
            });
            if (hasArrow) {
                console.log(`   Arrow returned at ${(i+1)*10}s - response complete`);
                await this.page.waitForTimeout(2000);
                return;
            }
            console.log(`   Still waiting... ${(i+1)*10}s`);
        }
        
        console.log('   Timeout, continuing');
    }

    async sendMessage(
        message: string, 
        features: DeepSeekFeatures = {}, 
        options: SendMessageOptions = {}
    ): Promise<DeepSeekResponse> {
        if (!this.isInitialized || !this.page) {
            throw new DeepSeekError('Client not initialized', 'NOT_INITIALIZED');
        }

        const startTime = Date.now();

        try {
            await this.page.bringToFront();
            
            if (features.deepThink !== undefined) {
                await this.setDeepThink(features.deepThink);
            }
            if (features.webSearch !== undefined) {
                await this.setWebSearch(features.webSearch);
            }
            
            await this.page.click('textarea, [contenteditable="true"]');
            await this.page.keyboard.press('Control+A');
            await this.page.keyboard.press('Backspace');
            
            if (message.length <= 50) {
                console.log(`⌨️ Typing ${message.length} chars like a human...`);
                for (const char of message) {
                    await this.page.keyboard.type(char);
                    await this.page.waitForTimeout(300 + Math.random() * 100);
                }
                await this.page.waitForTimeout(1500);
            } else {
                console.log(`📋 Pasting ${message.length} chars via clipboard...`);
                await this.page.evaluate((text) => {
                    navigator.clipboard.writeText(text);
                }, message);
                await this.page.waitForTimeout(500);
                await this.page.keyboard.press('Control+V');
                await this.page.waitForTimeout(1000);
                
                const inputText = await this.page.evaluate(() => {
                    const input = document.querySelector('textarea, [contenteditable="true"]');
                    if (input instanceof HTMLTextAreaElement) {
                        return input.value;
                    }
                    return input?.textContent || '';
                });
                
                if (!inputText || inputText.length < message.length / 2) {
                    console.log('   ⚠️ Clipboard paste failed, using direct input...');
                    await this.page.evaluate((text) => {
                        const input = document.querySelector('textarea, [contenteditable="true"]');
                        if (input) {
                            if (input instanceof HTMLTextAreaElement) {
                                input.value = text;
                            } else {
                                input.textContent = text;
                            }
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, message);
                    await this.page.waitForTimeout(1000);
                }
            }
            
            await this.page.keyboard.press('Enter');
            await this.waitForResponseComplete();
            
            let response = await this.getResponseViaCopyButton();
            if (!response && this.strategy !== 'copy-button') {
                response = await this.getResponseViaParsing(message);
            }

            return {
                content: response || "No response",
                duration: Date.now() - startTime,
                featuresUsed: features,
                estimatedTokens: Math.ceil(message.length / 4) + Math.ceil((response?.length || 0) / 4)
            };

        } catch (error) {
            throw new DeepSeekError(`Send failed: ${error}`, 'SEND_ERROR');
        }
    }

    private async getResponseViaCopyButton(): Promise<string> {
        if (!this.page) return '';
        
        console.log('   📋 Trying copy button...');
        
        try {
            const result = await this.page.evaluate(() => {
                const allElements = Array.from(document.querySelectorAll('*'));
                const copyButtons: HTMLElement[] = [];
                
                for (const el of allElements) {
                    const svgPath = el.querySelector('svg path');
                    if (svgPath) {
                        const d = svgPath.getAttribute('d') || '';
                        if (d.startsWith('M6.')) {
                            const button = el.closest('button, [role="button"]') as HTMLElement;
                            if (button) {
                                copyButtons.push(button);
                            }
                        }
                    }
                }
                
                if (copyButtons.length === 0) return null;
                const lastButton = copyButtons[copyButtons.length - 1];
                lastButton.click();
                return { success: true, count: copyButtons.length };
            });
            
            if (!result) {
                console.log('   No copy buttons found');
                return '';
            }
            
            console.log(`   Found ${result.count} button(s), clicked last`);
            await this.page.waitForTimeout(1000);
            
            const clipboardText = await this.page.evaluate(() => {
                try {
                    return navigator.clipboard.readText();
                } catch(e) {
                    return '';
                }
            });
            
            if (clipboardText && clipboardText.length > 0) {
                console.log(`   ✅ Got ${clipboardText.length} chars`);
                return clipboardText;
            }
            
            return '';
        } catch (error) {
            console.log(`   Copy button failed: ${error}`);
            return '';
        }
    }

    private async getResponseViaParsing(userMessage: string): Promise<string> {
        if (!this.page) return '';
        
        console.log('   📝 Trying parsing...');
        
        try {
            const fullText = await this.page.evaluate(() => document.body.innerText);
            const lines = fullText.split('\n');
            
            let userIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(userMessage.substring(0, 30))) {
                    userIndex = i;
                    break;
                }
            }
            
            if (userIndex === -1) {
                const lastLines = lines.slice(-20);
                for (let i = lastLines.length - 1; i >= 0; i--) {
                    if (lastLines[i].length > 20 && !lastLines[i].includes('DeepSeek')) {
                        return lastLines[i];
                    }
                }
                return '';
            }
            
            for (let i = userIndex + 1; i < lines.length; i++) {
                if (lines[i].length > 20 && !lines[i].includes('DeepSeek')) {
                    return lines[i];
                }
            }
            
            return '';
        } catch (error) {
            console.log(`   Parsing failed: ${error}`);
            return '';
        }
    }

    async isDeepThinkEnabled(): Promise<boolean> {
        if (!this.page) return false;
        const button = await this.page.$('.ds-toggle-button:has-text("DeepThink"), .ds-toggle-button:has-text("Глубокое мышление")');
        if (!button) return false;
        return await button.evaluate((el) => el.classList.contains('ds-toggle-button--selected'));
    }

    async setDeepThink(enabled: boolean): Promise<void> {
        if (!this.page) return;
        const button = await this.page.$('.ds-toggle-button:has-text("DeepThink"), .ds-toggle-button:has-text("Глубокое мышление")');
        if (!button) return;
        const isSelected = await button.evaluate((el) => el.classList.contains('ds-toggle-button--selected'));
        if (enabled !== isSelected) {
            await button.click();
            await this.page.waitForTimeout(500);
            console.log(`🧠 DeepThink ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    async isWebSearchEnabled(): Promise<boolean> {
        if (!this.page) return false;
        const button = await this.page.$('.ds-toggle-button:has-text("Search"), .ds-toggle-button:has-text("Умный поиск")');
        if (!button) return false;
        return await button.evaluate((el) => el.classList.contains('ds-toggle-button--selected'));
    }

    async setWebSearch(enabled: boolean): Promise<void> {
        if (!this.page) return;
        const button = await this.page.$('.ds-toggle-button:has-text("Search"), .ds-toggle-button:has-text("Умный поиск")');
        if (!button) return;
        const isSelected = await button.evaluate((el) => el.classList.contains('ds-toggle-button--selected'));
        if (enabled !== isSelected) {
            await button.click();
            await this.page.waitForTimeout(500);
            console.log(`🌐 Web Search ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    async isExpertModeEnabled(): Promise<boolean> {
        if (!this.page) return false;
        const expertButton = await this.page.$('.dfb78875:has-text("Expert"), .dfb78875:has-text("Эксперт")');
        if (!expertButton) return false;
        return await expertButton.evaluate((el) => el.classList.contains('_37fb93d'));
    }

    async setExpertMode(enabled: boolean): Promise<void> {
        if (!this.page) return;
        const modeName = enabled ? 'Expert' : 'Quick';
        const button = await this.page.$(`.dfb78875:has-text("${modeName}"), .dfb78875:has-text("${enabled ? 'Эксперт' : 'Быстрый'}")`);
        if (!button) return;
        const isActive = await button.evaluate((el) => el.classList.contains('_37fb93d'));
        if (enabled !== isActive) {
            await button.click();
            await this.page.waitForTimeout(1000);
            console.log(`⚡ Switched to ${modeName} mode`);
        }
    }

    async uploadFile(filePath: string): Promise<void> {
        if (!this.page) throw new DeepSeekError('Client not initialized', 'NOT_INITIALIZED');
        
        console.log(`📎 Uploading file: ${filePath}`);
        
        const uploadButton = await this.page.$('button[aria-label*="upload"], button[aria-label*="загрузить"], .ds-icon-button');
        if (!uploadButton) throw new Error('Upload button not found');
        
        await uploadButton.click();
        await this.page.waitForTimeout(1000);
        
        const fileInput = await this.page.$('input[type="file"]');
        if (!fileInput) throw new Error('File input not found');
        
        await fileInput.setInputFiles(filePath);
        await this.page.waitForTimeout(2000);
        console.log(`   ✅ File uploaded`);
    }

    async uploadFiles(filePaths: string[]): Promise<void> {
        for (const filePath of filePaths) {
            await this.uploadFile(filePath);
        }
    }

    private getStatePath(): string {
        if (this.config.statePath) {
            const dir = path.dirname(this.config.statePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            return this.config.statePath;
        }
        const browsersPath = getBrowsersPath();
        return path.join(browsersPath, '..', 'state.json');
    }

    private async saveState(): Promise<void> {
        if (!this.context) return;
        try {
            const state = await this.context.storageState();
            const statePath = this.getStatePath();
            const dir = path.dirname(statePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
            console.log(`💾 Session state saved to ${statePath}`);
        } catch (error) {
            console.warn('Failed to save state:', error);
        }
    }

    private async loadState(): Promise<any> {
        try {
            const statePath = this.getStatePath();
            console.log(`🔍 Looking for session at: ${statePath}`);
            if (fs.existsSync(statePath)) {
                const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                console.log(`📂 Loaded session state from ${statePath}`);
                console.log(`   Cookies: ${state.cookies?.length || 0}`);
                return state;
            } else {
                console.log(`⚠️ Session file not found: ${statePath}`);
            }
        } catch (error) {
            console.warn('Failed to load state:', error);
        }
        return undefined;
    }

    async close(): Promise<void> {
        if (this.context) {
            await this.saveState();
            await this.context.close();
        }
        if (this.browser) await this.browser.close();
        this.isInitialized = false;
    }
}

export default DeepSeekClient;