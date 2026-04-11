// src/utils/selectors.ts

export const Selectors = {
    // Поле ввода
    input: 'textarea, [contenteditable="true"], [role="textbox"]',
    
    // Кнопки режимов (русский и английский)
    deepThink: [
        '.ds-toggle-button:has-text("DeepThink")',
        '.ds-toggle-button:has-text("Глубокое мышление")',
        '[role="button"]:has-text("DeepThink")',
        '[role="button"]:has-text("Глубокое мышление")'
    ],
    
    webSearch: [
        '.ds-toggle-button:has-text("Search")',
        '.ds-toggle-button:has-text("Умный поиск")',
        '[role="button"]:has-text("Search")',
        '[role="button"]:has-text("Умный поиск")'
    ],
    
    // Кнопка нового чата
    newChat: [
        'button:has-text("New chat")',
        'button:has-text("Новый чат")',
        '[aria-label="New chat"]'
    ],
    
    // Кнопка входа
    login: [
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("Войти")',
        'button:has-text("Log in")'
    ],
    
    // Индикаторы печати
    typing: [
        '.typing-indicator',
        '[class*="typing"]',
        '[class*="loading"]',
        '.loader'
    ],
    
    // Паттерн для поиска кнопок копирования
    copyButtonPattern: 'ds-icon-button ds-icon-button--m ds-icon-button--sizing-container" tabindex="0" role="button" aria-disabled="false"><div class="ds-icon-button__hover-bg"></div><div class="ds-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">',
    
    // Паттерн для исключения кнопки истории
    historyButtonPattern: '<div class="ds-icon"><div class="ds-icon" style="font-size: 16px; width: 16px; height: 16px; color: var(--dsw-alias-label-tertiary);">'
};