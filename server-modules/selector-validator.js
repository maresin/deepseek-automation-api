// server-modules/selector-validator.js
/**
 * @file server-modules/selector-validator.js
 * Validates critical UI selectors at server startup.
 * Ensures the DeepSeek interface is in a known state before the API starts.
 *
 * CRITICAL selectors: must exist for the automation to work.
 * OPTIONAL selectors: depend on UI state (e.g., sidebar collapsed/expanded).
 */

const { Selectors } = require('../dist/browser/Selectors.js');

// ============================================================
// CRITICAL SELECTORS (required for automation to work)
// ============================================================
const CRITICAL_SELECTORS = [
    // Authentication (login page)
    { name: 'emailInput', selector: Selectors.emailInput },
    { name: 'passwordInput', selector: Selectors.passwordInput },
    { name: 'loginButton', selector: Selectors.loginButton },
    // Chat (after login)
    { name: 'mainTextarea', selector: Selectors.mainTextarea },
    { name: 'sendButtonExists', selector: Selectors.sendButtonExists },
    { name: 'attachButton', selector: Selectors.attachButton },
    { name: 'deepThinkButton', selector: Selectors.deepThinkButton },
    { name: 'webSearchButton', selector: Selectors.webSearchButton },
    { name: 'sidebarToggle', selector: Selectors.sidebarToggle },
];

// ============================================================
// OPTIONAL SELECTORS (depend on UI state)
// ============================================================
const OPTIONAL_SELECTORS = [
    { name: 'newChatButtonIcon', selector: Selectors.newChatButtonIcon },
];

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

/**
 * Validates all critical and optional selectors on the current page.
 * Selects appropriate selectors based on current page (login or chat).
 * @param {import('playwright-core').Page} page - Playwright page object.
 * @returns {Promise<{ results: Array, allFound: boolean }>}
 */
async function validateSelectors(page) {
    console.log('🔍 Validating critical selectors...');
    const results = [];
    let allFound = true;

    // Determine current page type
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/sign_in');
    const isChatPage = currentUrl.includes('/chat') || currentUrl.includes('/a/chat');

    // Select appropriate selectors based on page
    let selectorsToCheck = [];
    if (isLoginPage) {
        console.log('📌 On login page, checking authentication selectors...');
        selectorsToCheck = CRITICAL_SELECTORS.filter(s =>
            ['emailInput', 'passwordInput', 'loginButton'].includes(s.name)
        );
    } else if (isChatPage) {
        console.log('📌 On chat page, checking chat selectors...');
        selectorsToCheck = CRITICAL_SELECTORS.filter(s =>
            !['emailInput', 'passwordInput', 'loginButton'].includes(s.name)
        );
    } else {
        // Unknown page — check all selectors
        selectorsToCheck = CRITICAL_SELECTORS;
    }

    // Check critical selectors
    for (const item of selectorsToCheck) {
        try {
            if (!item.selector || typeof item.selector !== 'string') {
                results.push({ ...item, found: false, error: 'invalid selector' });
                allFound = false;
                console.error(`❌ Invalid selector for: ${item.name}`);
                continue;
            }
            const element = await page.$(item.selector);
            const found = !!element;
            results.push({ ...item, found });
            if (!found) {
                allFound = false;
                console.error(`❌ Critical selector not found: ${item.name} (${item.selector})`);
            } else {
                console.log(`✅ ${item.name} found`);
            }
        } catch (err) {
            results.push({ ...item, found: false, error: err.message });
            allFound = false;
            console.error(`❌ Error checking ${item.name}: ${err.message}`);
        }
    }

    // Check optional selectors (warnings only)
    console.log('\n🔍 Checking optional selectors...');
    for (const item of OPTIONAL_SELECTORS) {
        try {
            if (!item.selector || typeof item.selector !== 'string') {
                console.warn(`⚠️ Optional selector ${item.name} invalid, skipping`);
                continue;
            }
            const element = await page.$(item.selector);
            const found = !!element;
            if (!found) {
                console.warn(`⚠️ Optional selector not found: ${item.name} (${item.selector}) — this is normal if sidebar is expanded`);
            } else {
                console.log(`✅ ${item.name} found (sidebar is collapsed)`);
            }
        } catch (err) {
            console.warn(`⚠️ Error checking optional selector ${item.name}: ${err.message}`);
        }
    }

    return { results, allFound };
}

/**
 * Ensures the DeepSeek interface language is set to English.
 * Opens Settings → General → Language, switches to "English" if needed.
 * @param {import('playwright-core').Page} page - Playwright page object.
 * @returns {Promise<boolean>} true if language is English or was switched.
 */
async function ensureEnglishLanguage(page) {
    console.log('🌐 Checking interface language...');

    const isEnglish = await page.isVisible('textarea[placeholder*="Message DeepSeek"]').catch(() => false);
    if (isEnglish) {
        console.log('✅ Interface language is English');
        return true;
    }

    console.log('⚠️ Switching language to English...');
    try {
        await page.evaluate(() => {
            const icons = document.querySelectorAll('.ds-icon');
            for (const icon of icons) {
                const svg = icon.querySelector('svg');
                if (svg && svg.innerHTML.includes('M4.55146 8.00001')) {
                    const parent = icon.closest('[tabindex="0"]');
                    if (parent) {
                        parent.click();
                        return;
                    }
                }
            }
        });
        await page.waitForTimeout(2000);

        const settingsItem = await page.$(Selectors.settingsMenuItem);
        if (settingsItem) {
            await settingsItem.click();
            await page.waitForTimeout(3000);
        } else {
            console.warn('⚠️ Settings menu item not found, skipping language switch');
            return false;
        }

        const generalTab = await page.$(Selectors.settingsTabGeneral);
        if (generalTab) {
            await generalTab.click();
            await page.waitForTimeout(1000);
        } else {
            console.warn('⚠️ General tab not found, skipping language switch');
            await closeSettings(page);
            return false;
        }

        const langSelect = await page.$(Selectors.languageSelect);
        if (langSelect) {
            await langSelect.click();
            await page.waitForTimeout(1500);
        } else {
            console.warn('⚠️ Language select not found, skipping language switch');
            await closeSettings(page);
            return false;
        }

        const englishOption = await page.$(Selectors.languageOptionEnglish);
        if (englishOption) {
            await englishOption.click();
            await page.waitForTimeout(2000);
            console.log('✅ Language switched to English');
        } else {
            console.warn('⚠️ English language option not found, continuing with current language');
        }

        await closeSettings(page);
        return true;

    } catch (err) {
        console.error('❌ Language switch failed:', err.message);
        await closeSettings(page).catch(() => {});
        return false;
    }
}

/**
 * Closes the settings modal (click close button or press Escape).
 * @param {import('playwright-core').Page} page - Playwright page object.
 */
async function closeSettings(page) {
    const closeBtn = await page.$(Selectors.settingsClose);
    if (closeBtn) {
        await closeBtn.click();
    } else {
        await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(1500);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    validateSelectors,
    ensureEnglishLanguage,
    CRITICAL_SELECTORS,
    OPTIONAL_SELECTORS,
};