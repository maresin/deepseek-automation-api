# Установка

## Требования

- Node.js 18+
- npm 8+
- Свободный DeepSeek-аккаунт (https://chat.deepseek.com)
- ~500 МБ на диске (Chromium + node_modules)

## Шаги

### 1. Клонирование

```bash
git clone https://github.com/maresin/deepseek-automation-api.git
cd deepseek-automation-api
```

### 2. Установка зависимостей

```bash
npm install
npm run build
```

`npm install` запускает `postinstall` → `scripts/install-browser.js`,
который скачивает Chromium в `./browsers`. Если скрипт не сработал
(например, нет доступа к сети) — установите Chromium вручную, см.
шаг 3.

### 3. Установка Chromium

Проект использует локальную копию Chromium в `./browsers`, а не
глобальный кэш Playwright. Это делает checkout самодостаточным.

```bash
mkdir -p browsers
PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium
```

Это создаст `./browsers/chromium-<version>/`. Именно сюда смотрит
`src/utils/paths.ts` → `getChromiumExecutablePath()`.

### 4. Конфигурация `.env`

Создайте `.env` в корне проекта:

```ini
PORT=3000
DEEPSEEK_EMAIL=your@email.com
DEEPSEEK_PASSWORD=your_password
DEEPSEEK_HEADLESS=true
ENABLE_RESTORE=true
ENABLE_SNAPSHOT=false
ENABLE_RAG=false
```

Минимальный набор — `DEEPSEEK_EMAIL` и `DEEPSEEK_PASSWORD`. Если
они заданы, сервер залогинится автоматически при старте. Всё
остальное имеет значения по умолчанию.

Полный список переменных — в таблице ниже.

### 5. Запуск

```bash
npm start
```

Сервер начнёт работу на `http://localhost:3000`. При старте:

1. Проверит наличие `state.json` и `.api-key`.
2. Если найдёт — восстановит сессию (`ENABLE_RESTORE=true`).
3. Если `.env` содержит credentials — зарегистрируется автоматически.
4. Провалидирует селекторы через `selector-validator`.

Если критичный селектор отсутствует — сервер завершится с ошибкой.
Это защита от «тихой» работы на устаревших селекторах.

## Переменные окружения

### Core

| Переменная | Описание | По умолчанию |
|---|---|---|
| `PORT` | HTTP-порт | `3000` |
| `DEEPSEEK_EMAIL` | Email для авто-логина | — |
| `DEEPSEEK_PASSWORD` | Пароль для авто-логина | — |
| `DEEPSEEK_HEADLESS` | Запуск Chromium без окна | `false` |

### Recovery modes

| Переменная | Описание | По умолчанию |
|---|---|---|
| `ENABLE_RESTORE` | Восстанавливать последний чат при старте | `false` |
| `ENABLE_SNAPSHOT` | Создавать снапшоты на 70% / 90% | `false` |
| `ENABLE_RAG` | Индексировать историю и искать по ней | `false` |

### Paths

| Переменная | По умолчанию | Описание |
|---|---|---|
| `DEEPSEEK_STATE_PATH` | `./state.json` | Cookies и origins (Playwright) |
| `DEEPSEEK_CHAT_STATE_PATH` | `./chat_state.json` | Состояние чата: `lastChatId`, счётчики, флаги |
| `DEEPSEEK_API_KEY_PATH` | `./.api-key` | API-ключ сессии |
| `DEEPSEEK_UPLOAD_DIR` | `./uploads` | Вложения, снапшоты, RAG-контекст |

> **Директория uploads.** Используется для multipart-загрузок,
> снапшота (`snapshot.txt`) и файлов RAG-контекста
> (`rag_context_*.txt`). По умолчанию — `./uploads` в корне проекта.
> Относительные пути из `DEEPSEEK_UPLOAD_DIR` разрешаются от корня
> проекта. Директория создаётся автоматически при первом обращении.
>
> Типичные сценарии:
> - Docker: смонтировать volume (`DEEPSEEK_UPLOAD_DIR=/data/uploads`).
> - Отдельный диск: вынести на быстрый раздел.
> - Тесты: изолировать во временную директорию.

### Context and RAG tuning

| Переменная | По умолчанию | Описание |
|---|---|---|
| `DEEPSEEK_MAX_CONTEXT_CHARS` | `2400000` | Fallback-лимит до анализа языка |
| `DEEPSEEK_DEEPTHINK_MULTIPLIER` | `2.5` | Множитель контекста при DeepThink |
| `RAG_CHUNK_SIZE` | `2000` | Символов на чанк эмбеддинга |
| `RAG_RECENCY_FLOOR` | `0.7` | Минимальный множитель свежести в ранжировании |
| `RAG_DATA_DIR` | `./rag_data` | Директория для индексов |

> **Модель эмбеддингов** (`Xenova/all-MiniLM-L6-v2`) загружается при
> первом RAG-запросе. Ожидайте задержку 2–3 секунды на этом запросе.

## Проверка работы

### 1. Health check

```bash
curl http://localhost:3000/health
```

Ожидается `{"status":"ok","timestamp":"..."}`.

### 2. Регистрация

```bash
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

Ожидается `{"api_key":"deepseek_...","message":"..."}`.

### 3. Первый чат

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

Ожидается ответ с `choices[0].message.content`.

## Обновление

```bash
git pull
npm install
npm run build
npm start
```

Сохраняются между обновлениями:

- `state.json` — cookies браузера.
- `chat_state.json` — состояние чата.
- `.api-key` — API-ключ.
- `rag_data/` — индексы RAG (если включён).
- `uploads/` — временные файлы (можно чистить вручную).

## Удаление

```bash
npm run clean
rm -rf node_modules browsers
```

Команда `clean` удаляет: `dist/`, `browsers/`, `uploads/`,
`state.json`, `chat_state.json`, `context_stats.json`,
`context_snapshot.json`, `.api-key`, `rag_data/`.

## Требования к среде

- **ОС:** Linux, macOS, Windows.
- **Node.js:** 18+ (используется native `fetch`, top-level `await`).
- **Chromium:** устанавливается в `./browsers` через Playwright.
- **Память:** ~500 МБ при активной сессии (Chromium + модель
  эмбеддингов).
- **Диск:** ~500 МБ на Chromium + node_modules; `uploads/` растёт
  в зависимости от нагрузки.

## Связанные разделы

- [Использование](usage.md) — примеры работы с API.
- [Управление сессией](session-management.md) — два лимита, деградация,
  обработка ошибок.
- [Тестирование](testing.md) — селекторы, API, RAG.
- [Диагностика](troubleshooting.md) — частые проблемы.
- [Алгоритмы](../algorithms/index.md) — контрактные описания всех
  процессов.

