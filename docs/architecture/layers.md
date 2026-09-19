# Архитектура: слои

Проект разделён на слои по принципу «каждый слой знает только о нижнем».
Это позволяет менять реализацию одного слоя без переписывания соседей.

## Слой 1: Транспорт (server.js + server-modules/)

**Задача:** принять HTTP, провалидировать, транслировать в вызов клиента.

- `middleware.js` — rate limit, Bearer auth.
- `routes/*.js` — эндпоинты.
- `state.js` — singleton клиента.
- `utils.js` — файловые пути, `buildPrompt`, API-ключ.

Слой **не знает** про Playwright и селекторы. Он работает с
`DeepSeekClient` как с чёрным ящиком.

## Слой 2: Оркестрация (src/DeepSeekClient.ts + src/task/)

**Задача:** управлять жизненным циклом браузера, сессии, контекста.

- `DeepSeekClient` — фасад. Методы `initialize`, `executePipeline`,
  `startFresh`, `restorePrevious`, `handleOverflow`.
- `TaskQueue` — сериализация.
- `Task` — базовый класс с ретраями.

Слой **не знает** про DOM. Он вызывает `ChatController`,
`ResponseExtractor`, `ContextManager`.

## Слой 3: UI-операции (src/chat/, src/features/, src/file/)

**Задача:** выполнять конкретные действия в UI DeepSeek.

- `ChatController` — send, attach, wait, new chat, restore.
- `ResponseExtractor` — Copy, markdown fallback, баннеры, Server Busy.
- `FeatureToggles` — DeepThink, Web Search.
- `FileUploader` — оценка размера, делегирование в ChatController.

Слой **знает** про DOM и селекторы, но не про HTTP.

## Слой 4: Контекст и RAG (src/context/, src/rag/)

**Задача:** отслеживать размер контекста, хранить историю для поиска.

- `ContextManager` — `totalChars`, снапшоты, язык.
- `HistoryStore` — индекс, поиск, reassign.
- `LinearIndex` — низкоуровневое хранилище векторов.
- `IndexingQueue` — фоновый worker.

Слой **знает** про `DeepSeekClient` (для снапшотов), но не про HTTP.

## Слой 5: Браузер (src/browser/, src/auth/)

**Задача:** предоставить управляемую страницу Playwright.

- `BrowserManager` — launch, goto, saveState, clipboard override.
- `AuthManager` — логин.
- `Selectors` — единый источник селекторов.

Слой **не знает** ни о чём выше. Это фундамент.

## Правило зависимостей

```
Слой 5 (Browser)     ← не зависит ни от чего
Слой 4 (Context/RAG) ← зависит от 5
Слой 3 (UI)          ← зависит от 5
Слой 2 (Orchestration) ← зависит от 3, 4, 5
Слой 1 (Transport)   ← зависит от 2
```

Стрелки только снизу вверх. Нарушение (импорт сверху вниз) —
архитектурная ошибка.

## Почему слои, а не плоская структура

**Тестируемость.** `Selectors` можно проверить без запуска сервера
(`tests/selector-tests/`). `ChatController` тестируется с mock-страницей.

**Изоляция изменений.** Изменение селектора не задевает HTTP-код.
Изменение формулы ранжирования RAG не задевает UI-операции.

**Понятность.** Новый разработчик видит: «слой 3 работает с DOM,
слой 4 — с числами». Это ориентир.

См. [Поток данных](data-flow.md).