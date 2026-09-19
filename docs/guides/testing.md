# Тестирование

## Обзор

Три группы тестов:

1. **Селекторы** (`tests/selector-tests/`) — проверка UI-селекторов
   против живого DeepSeek.
2. **API-интеграция** (`tests/api-tests/api-integration-node.js`) —
   контракт HTTP API.
3. **Перенос контекста** (`tests/api-tests/api-integration-rag.js`) —
   snapshot- и RAG-сценарии, включая реальный переход в новый чат.

## Тесты селекторов

Запускаются **без** сервера. Открывают Chromium через Playwright,
идут на `chat.deepseek.com`, проверяют каждый селектор из
`Selectors.ts`.

```bash
npm run test:selectors
```

**Когда запускать:** после изменений в `src/browser/Selectors.ts` или
после любых подозрений на изменение UI DeepSeek.

**Опции:**
```bash
# Показать браузер (по умолчанию headless)
SELECTOR_TEST_HEADLESS=false npm run test:selectors

# Отключить overlay
SELECTOR_TEST_OVERLAY=false npm run test:selectors
```

**Требования:** `state.json` (cookies). Сервер запускать не нужно.

## API-тесты

Запускаются **при работающем сервере**.

```bash
# Терминал 1
npm start

# Терминал 2 (после того как сервер поднялся)
npm run test:api
```

Проверяют:
- `/v1/register`, `/v1/chat/new`, `/v1/context/status`.
- `/v1/chat/completions` (plain, system, multi-turn).
- Tool calling.
- `extra_body.deepthink`, `extra_body.web_search`.
- Upload одиночный и множественный, `file_id` reference, SVG-картинка.
- Валидацию: 401, 400 (пустой messages, неизвестная роль, невалидный
  tools, несуществующий file_id).
- `/v1/chat/single` (`return_only`, `insert_to_context`).

**Требования:** `tests/config.env`, `tests/data/images/lenna.png`.

## RAG / snapshot тесты

Проверяют **перенос контекста** между чатами — то, что нельзя
проверить без реального переполнения.

```bash
npm run test:rag
```

Тест запускает собственный экземпляр сервера дважды: один раз с
`ENABLE_SNAPSHOT=true`, второй — с `ENABLE_RAG=true`. Каждый раз:
1. Открывает новый чат.
2. Загружает четыре маркерных файла, пересекая пороги 70% и 90%.
3. Отправляет тривиальное сообщение → срабатывает `handleOverflow`.
4. Спрашивает про маркер из старого чата — единственный источник в
   новом чате это механизм под тестом.
5. Перезапускает сервер, проверяет сохранение состояния.
6. Спрашивает про второй маркер после перезапуска.

**Требования:** `.api-key` должен существовать. Другой экземпляр
сервера на том же порту должен быть остановлен.

## Отладка

### Порт занят (`EADDRINUSE`)

Самая частая проблема. `test:api` требует работающий сервер на порту
3000; `test:rag` требует **свободный** порт (он спавнит свой сервер).
Оба сценария при неверном состоянии дают одну и ту же ошибку:

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Решение:**

```bash
# Найти, кто держит порт
lsof -i :3000

# Убить конкретный процесс (замените <PID>)
kill <PID>

# Или, если точно знаете, что это зависший сервер от предыдущего запуска:
pkill -f "node server.js"
```

**Проверка, что порт свободен:**

```bash
lsof -i :3000    # пусто
curl http://localhost:3000/health    # connection refused
```

**Осторожно с `pkill`.** Команда `pkill -f "node server.js"` убьёт
любой процесс, в командной строке которого есть `node server.js`. На
локальной машине это безопасно. На общей — используйте `lsof -i :3000`
и `kill <PID>`.

### Селекторы не найдены

1. Запустите `SELECTOR_TEST_HEADLESS=false npm run test:selectors`.
2. Посмотрите, какой именно селектор упал.
3. Найдите элемент в инспекторе.
4. Обновите `src/browser/Selectors.ts`.
5. Повторите.

### API возвращает 503

Клиент не готов. Проверьте:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/v1/context/status -H "Authorization: Bearer $KEY"
```

### API возвращает 409

Контекст исчерпан. Это ожидаемо для длинных тестов:
```bash
curl -X POST http://localhost:3000/v1/chat/new \
  -H "Authorization: Bearer $KEY" \
  -d '{"restore": false}'
```

### Chromium не запускается

```bash
ls browsers/chromium-*/
```

Если пусто:
```bash
PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium
```

## Что не тестируется автоматически

- Cloudflare / captcha — только вручную.
- Реальные ошибки DeepSeek Server Busy — воспроизводятся редко.
- Внешние RAG-сценарии с файлами > 10 МБ (требуют времени).

Эти сценарии проверяются вручную, см.
[диагностику](troubleshooting.md).

См. [алгоритмы](../algorithms/index.md) и
[управление сессией](session-management.md).