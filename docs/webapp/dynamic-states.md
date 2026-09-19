# Динамические состояния UI

Интерфейс DeepSeek переключается между несколькими состояниями,
каждое из которых требует особой обработки.

## 1. Загрузка (Loading)

**Признаки:** после `page.goto` textarea ещё не отрендерена.

**Обработка:** `waitForSelector(mainTextarea, { timeout: 30000 })`.

## 2. Готов к вводу (Ready)

**Признаки:** textarea видна, Send выключен (класс `ds-button--disabled`),
тогглы доступны.

**Обработка:** можно печатать текст, прикреплять файлы.

## 3. Ввод (Typing)

**Признаки:** в textarea есть текст или прикреплён файл, Send активен.

**Обработка:** `send()` нажимает Enter или кликает Send.

## 4. Генерация (Generating)

**Признаки:**
- Send заменён на Stop (SVG path `M2 4.88`).
- Тогглы могут быть недоступны.
- В ленте — растущий блок ассистента.

**Обработка:** `waitForChunkComplete` ждёт исчезновения Stop.

## 5. Пауза (Paused, длинный ответ)

**Признаки:**
- Stop исчез, но ответ не завершён.
- В футере ассистентского сообщения появилась кнопка Continue.

**Обработка:** `waitForFullResponse` кликает Continue и продолжает
ожидание. Ассистентский ключ не меняется.

## 6. Завершено (Done)

**Признаки:**
- Send активен (нет `ds-button--disabled`).
- Stop отсутствует.
- В футере доступны Copy / Regenerate.

**Обработка:** `getCopyTextByKeyWithRegenerate` извлекает текст.

## 7. Server Busy

**Признаки:**
- В блоке сообщения присутствует SVG path `M9.94076 1.34942`
  (Retry) **или** span с текстом `Server busy, please try again later.`
- Ответ пуст.

**Обработка:** `detectServerBusy` возвращает true → `ServerBusyError`
→ HTTP 503 → `process.exit(1)`.

## 8. Length Limit

**Признаки:**
- В тексте страницы есть подстрока `Length limit reached ...`.
- Возможны варианты: `first 75%`, `first 90%`, без процентов.

**Обработка:** `detectBanner` / `detectLengthLimit` → `ContextExhaustedError`
→ HTTP 409.

## 9. Плавающая кнопка Scroll-to-Bottom

**Признаки:** кнопка `[role="button"].ds-button--floating:has(svg path[d^="M11.8486 5.5"])` видна.

**Обработка:** `scrollToBottomIfNeeded` кликает её перед проверкой
футера (иначе Continue/Copy не отрендерены).

## 10. Свёрнутый сайдбар

**Признаки:** текст «New chat» не виден, есть иконка
`svg path[d^="M8 0.599609"]`.

**Обработка:** `ensureSidebarExpanded` кликает toggle или перезагружает
страницу.

## 11. Dropdown скрепки

**Признаки:** после клика по скрепке появляется dropdown (не нативный
диалог).

**Обработка:** `attachFile` нажимает Escape и работает с `input[type=file]`
напрямую.

## 12. Бейдж файла в состоянии ошибки

**Признаки:** бейдж содержит текст `server busy` / `upload failed` /
`network error` / `retry` / `try again`.

**Обработка:** `attachFile` кликает по бейджу (retry), до 5 раз.

## Матрица совместимости

| Селектор | Ready | Typing | Generating | Paused | Done | Busy | Limit |
|---|---|---|---|---|---|---|---|
| `mainTextarea` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sendButton` | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ |
| `stopButton` | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `continueButton` | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `deepThinkButton` | ✓ | ✓ | ~ | ~ | ✓ | ✗ | ✗ |
| `webSearchButton` | ✓ | ✓ | ~ | ~ | ✓ | ✗ | ✗ |
| `scrollToBottomButton` | ✗ | ✗ | ~ | ✓ | ✓ | ✗ | ✗ |
| `retryButtonPathPrefix` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `lengthLimitBannerPattern` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

`~` — зависит от режима (Expert скрывает Search).

## Как детектить переходы

Основной приём — **двойная проверка через `getTriggerState`**:

```typescript
{
  stop: !!document.querySelector(stopSelector),
  sendDisabled: Array.from(document.querySelectorAll(sendSelector))
    .some(el => el.classList.contains('ds-button--disabled')),
  banner: body.textContent.match(bannerPattern)?.[0] || null,
}
```

Один round-trip за три сигнала. Этого достаточно для всех переходов.

См. [overview](overview.md) и [algorithms/response](../algorithms/response.md).