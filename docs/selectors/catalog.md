# Каталог селекторов

Единый источник селекторов — `src/browser/Selectors.ts`.
Ниже — человекочитаемая версия с описанием и приоритетами.

## Аутентификация

| Элемент | Селектор | Приоритет |
|---|---|---|
| Email/Phone | `input.ds-input__input[placeholder*="email"]` | класс + атрибут |
| Password | `input.ds-input__input[placeholder*="Password"]` | класс + атрибут |
| Log in | `.ds-button--primary.ds-button--filled:has-text("Log in")` | класс + текст |
| Log in (fallback) | `.ds-button--primary.ds-button--filled` | класс |

## Тогглы

| Элемент | Селектор | Состояние |
|---|---|---|
| DeepThink | `.ds-toggle-button:has-text("DeepThink")` | `.ds-toggle-button--selected` |
| Search | `.ds-toggle-button:has-text("Search")` | `.ds-toggle-button--selected` |

## Ввод и отправка

| Элемент | Селектор |
|---|---|
| Textarea | `textarea[placeholder*="Message DeepSeek"]:not([role="searchbox"])` |
| Send (активна) | `[role="button"].ds-button--circle:has(svg path[d^="M8.3125 0.98"]):not(.ds-button--disabled)` |
| Send (exists) | `[role="button"].ds-button--circle:has(svg path[d^="M8.3125 0.98"])` |
| Скрепка | `[role="button"]:has(svg path[d^="M5.5498 9.75V5"])` |
| File input | `input[type="file"]` |

## Генерация ответа

| Элемент | Селектор |
|---|---|
| Stop | `[role="button"].ds-button--circle:has(svg path[d^="M2 4.88"])` |
| Continue | `[role="button"]:has-text("Continue")` |
| Scroll-to-bottom | `[role="button"].ds-button--floating:has(svg path[d^="M11.8486 5.5"])` |

## Сайдбар

| Элемент | Селектор |
|---|---|
| New chat (icon) | `[role="button"]:has(svg path[d^="M8 0.599609"])` |
| Sidebar toggle | `[role="button"]:has(svg path[d^="M9.67272 0.522841"])` |
| Chat link | `a[href^="/a/chat/s/"]` |
| Chat context menu | `a[href^="/a/chat/s/"] [role="button"]:has(svg path[d^="M4.55146 8.00001"])` |

## Профиль и настройки

| Элемент | Селектор |
|---|---|
| Settings menu item | `.ds-dropdown-menu-option:has(.ds-dropdown-menu-option__label:has-text("Settings"))` |
| Settings close | `.ds-modal-content__close` |
| General tab | `[role="button"]:has-text("General")` |
| Language select | `.ds-select` |
| English option | `.ds-select-option:has(span:has-text("English")):not(:has(span:has-text("(")))` |

## Сообщения

| Элемент | Селектор |
|---|---|
| Message block | `[data-virtual-list-item-key]` |
| Markdown body | `.ds-markdown` (относительный) |
| File badge | `div:has(svg path[d^="M10.6074 4.40278"])` |

## SVG-пути (для page.evaluate)

Префиксы путей, используемые как substring:

| Назначение | Префикс |
|---|---|
| Stop | `M2 4.88` |
| Send | `M8.3125 0.98` |
| Regenerate | `M7.92136 0.349152` |
| Copy | `M6.14929 4.02032` |
| Download | `M15.3695 11.411` |
| Retry (Server busy) | `M9.94076 1.34942` |

## Текстовые константы

| Назначение | Значение |
|---|---|
| Continue label | `Continue` |
| Length limit pattern | `/Length limit reached[^\n]*/i` |
| Server busy text | `Server busy, please try again later.` |

Машинночитаемая версия — в [catalog.json](catalog.json).
Принципы выбора — в [principles](principles.md).