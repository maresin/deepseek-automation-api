// src/browser/Selectors.ts
export const Selectors = {
    textarea: 'textarea',
    sendButton: 'div[role="button"][aria-disabled="false"]:not(.ds-icon-button--disabled)',

    permanentNewChatButton: 'div[tabindex="0"]:has(svg path[d^="M8 0.599609"])',
    permanentNewChatButtonFallback: 'button:has-text("New chat"), button:has-text("Новый чат")',

    tempNewChatButton: 'button:has-text("New chat"), button:has-text("Новый чат")',

    deleteFileIcon: 'svg path[d^="M10.6074 4.40278"]',

    uploadButton: 'button[aria-label*="upload"], button[aria-label*="загрузить"], .ds-icon-button',
    fileInput: 'input[type="file"]',

    loadingIndicator: '.ds-icon-button--loading',
    copyButtonPath: 'svg path[d^="M6.14929"]',
    arrowIconPath: 'M8.3125 0.981587',

    deepThinkButton: '.ds-toggle-button:has-text("DeepThink"), .ds-toggle-button:has-text("Глубокое мышление")',
    webSearchButton: '.ds-toggle-button:has-text("Search"), .ds-toggle-button:has-text("Умный поиск")',
    expertModeRadio: 'div[data-model-type="expert"]',
    instantModeRadio: 'div[data-model-type="default"]',
    modeIndicatorText: 'span:has-text("Быстрый"), span:has-text("Instant"), span:has-text("Эксперт"), span:has-text("Expert")',

    signInPage: '/sign_in',
    mainPage: 'https://chat.deepseek.com',
    chatHistoryLink: 'a[href^="/a/chat/s/"]',

    emailInput: 'input[placeholder="Номер телефона / адрес электронной почты"], input[placeholder="Phone number / email address"]',
    passwordInput: 'input[placeholder="Пароль"], input[placeholder="Password"]',
    loginButton: 'button:has-text("Войти"), button:has-text("Log in")',
    loginButtonFallback: '.ds-basic-button--primary',

    virtualListItem: '[data-virtual-list-item-key]',
};