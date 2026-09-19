// src/browser/Selectors.ts
/**
 * @file src/browser/Selectors.ts
 * Centralized, stable selectors for DeepSeek UI automation.
 * All selectors are verified and avoid hashed classes.
 */

export const Selectors = {
    // ============================================================
    // AUTHENTICATION
    // ============================================================
    emailInput: 'input.ds-input__input[placeholder*="email"]',
    passwordInput: 'input.ds-input__input[placeholder*="Password"]',
    loginButton: '.ds-button--primary.ds-button--filled:has-text("Log in")',
    loginButtonFallback: '.ds-button--primary.ds-button--filled',
    signInPage: '/sign_in',

    // ============================================================
    // TOGGLES (DeepThink / Search)
    // ============================================================
    deepThinkButton: '.ds-toggle-button:has-text("DeepThink")',
    webSearchButton: '.ds-toggle-button:has-text("Search")',

    // ============================================================
    // INPUT & SEND
    // ============================================================
    mainTextarea: 'textarea[placeholder*="Message DeepSeek"]:not([role="searchbox"])',
    sendButton: '[role="button"].ds-button--circle:has(svg path[d^="M8.3125 0.98"]):not(.ds-button--disabled)',
    sendButtonExists: '[role="button"].ds-button--circle:has(svg path[d^="M8.3125 0.98"])',
    attachButton: '[role="button"]:has(svg path[d^="M5.5498 9.75V5"])',
    fileInput: 'input[type="file"]',

    // ============================================================
    // RESPONSE GENERATION
    // ============================================================
    stopButton: '[role="button"].ds-button--circle:has(svg path[d^="M2 4.88"])',
    continueButton: '[role="button"]:has-text("Continue")',
    scrollToBottomButton: '[role="button"].ds-button--floating:has(svg path[d^="M11.8486 5.5"])',

    // ============================================================
    // SIDEBAR & NAVIGATION
    // ============================================================
    newChatButtonIcon: '[role="button"]:has(svg path[d^="M8 0.599609"])',
    sidebarToggle: '[role="button"]:has(svg path[d^="M9.67272 0.522841"])',
    chatContextMenu: 'a[href^="/a/chat/s/"] [role="button"]:has(svg path[d^="M4.55146 8.00001"])',
    chatHistoryLink: 'a[href^="/a/chat/s/"]',

    // ============================================================
    // PROFILE & SETTINGS
    // ============================================================
    settingsMenuItem: '.ds-dropdown-menu-option:has(.ds-dropdown-menu-option__label:has-text("Settings"))',
    settingsClose: '.ds-modal-content__close',

    // ============================================================
    // LANGUAGE SELECT
    // ============================================================
    languageSelect: '.ds-select',
    languageOptionEnglish: '.ds-select-option:has(span:has-text("English")):not(:has(span:has-text("(")))',
    settingsTabGeneral: '[role="button"]:has-text("General")',

    // ============================================================
    // LOADING INDICATOR
    // ============================================================
    loadingIndicator: '.ds-loading',

    // ============================================================
    // MESSAGE CONTAINERS
    // ============================================================
    virtualListItem: '[data-virtual-list-item-key]',
    /**
     * Markdown body inside a message block. Resolved at runtime relative
     * to a specific data-virtual-list-item-key — see
     * ResponseExtractor.getResponseViaMarkdown — and not used as a
     * top-level CSS selector.
     */
    markdownBodyRelative: '.ds-markdown',

    // ============================================================
    // FILE BADGE
    // ============================================================
    fileBadge: 'div:has(svg path[d^="M10.6074 4.40278"])',

    // ============================================================
    // ICON PATH PREFIXES (used inside page.evaluate for DOM traversal)
    // These are not CSS selectors — they are substring prefixes of the
    // svg path[d] attribute. Verified against the live DeepSeek UI.
    // ============================================================
    stopButtonPathPrefix: 'M2 4.88',
    sendButtonPathPrefix: 'M8.3125 0.98',
    regenerateButtonPathPrefix: 'M7.92136 0.349152',
    copyButtonPathPrefix: 'M6.14929 4.02032',
    downloadButtonPathPrefix: 'M15.3695 11.411',
    /**
     * Path prefix of the Retry icon shown inside the "Server busy"
     * placeholder. Primary detection signal — survives UI localization.
     */
    retryButtonPathPrefix: 'M9.94076 1.34942',
    continueButtonText: 'Continue',
    lengthLimitBannerPattern: /Length limit reached[^\n]*/i,
    /**
     * Exact text of the "Server busy" warning span. Fallback detection
     * signal, used if DeepSeek changes the Retry icon markup.
     */
    serverBusyText: 'Server busy, please try again later.',
};