# Установка

## Требования

- Node.js 16+
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

### 3. Установка Chromium

Проект использует локальную копию Chromium в `./browsers`:

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
ENABLE_RESTORE=false
ENABLE_SNAPSHOT=false
ENABLE_RAG=false
```

Полный список переменных — в таблице ниже.

### 5. Запуск

```bash
npm start
```

Сервер начнёт работу на `http://localhost:3000`. При старте:
1. Проверит наличие `state.json` и `.api-key`.
2. Если найдёт — восстановит сессию.
3. Если `.env` содержит credentials — зарегистрируется автоматически.
4. Провалидирует селекторы.

## Переменные окружения

| Переменная | Описание | По умолчанию |
|---|---|---|
| `PORT` | HTTP-порт | `3000` |
| `DEEPSEEK_EMAIL` | Email для авто-логина | — |
| `DEEPSEEK_PASSWORD` | Пароль для авто-логина | — |
| `DEEPSEEK_HEADLESS` | Запуск Chromium без окна | `false` |
| `ENABLE_RESTORE` | Восстанавливать последний чат при старте | `false` |
| `ENABLE_SNAPSHOT` | Создавать снапшоты на 70% / 90% | `false` |
| `ENABLE_RAG` | Индексировать историю и искать по ней | `false` |
| `RAG_CHUNK_SIZE` | Размер чанка в символах | `2000` |
| `RAG_FRAGMENT_MAX_CHARS` | Макс. длина фрагмента в ответе | `1200` |
| `RAG_RECENCY_FLOOR` | Минимальный множитель свежести (R4) | `0.7` |
| `RAG_DATA_DIR` | Директория для индексов | `./rag_data` |
| `DEEPSEEK_DEEPTHINK_MULTIPLIER` | Множитель для DeepThink | `2.5` |
| `DEEPSEEK_MAX_CONTEXT_CHARS` | Fallback-лимит (символы) | `2400000` |
| `DEEPSEEK_STATE_PATH` | Путь к `state.json` | `./state.json` |
| `DEEPSEEK_CHAT_STATE_PATH` | Путь к `chat_state.json` | `./chat_state.json` |
| `DEEPSEEK_API_KEY_PATH` | Путь к `.api-key` | `./.api-key` |
| `DEEPSEEK_SYSTEM_PROMPT_PATH` | Путь к системному промпту | `./prompts/system_prompt.txt` |

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

`state.json`, `chat_state.json`, `.api-key` и `rag_data/` сохраняются
между обновлениями.

## Удаление

```bash
npm run clean
rm -rf node_modules browsers
```

См. [использование](usage.md) и [диагностику](troubleshooting.md).