# Тестирование

## Обзор

Четыре набора тестов, четыре файла в `tests/`:

| Файл | Что тестирует | Внешние зависимости |
|---|---|---|
| `api.test.js` | HTTP-контракт API | Запущенный сервер на порту 3000 |
| `context-transfer.test.js` | Snapshot и RAG переходы | Свободный порт 3000 (спавнит свой сервер) |
| `selectors.test.js` | UI-селекторы DeepSeek | Chromium и `state.json` |
| `response-parser.test.js` | Парсеры ответов модели | Нет |

## Unit-тесты (`response-parser.test.js`)

Самые быстрые — миллисекунды. Не требуют ни сервера, ни браузера,
ни сети.

```bash
npm run test:unit
```

Покрывают:
- Извлечение JSON из markdown-обёрток и преамбулы.
- Балансировку скобок с учётом строк и escape-последовательностей.
- Нормализацию плоского и вложенного форматов `tool_calls`.
- Восстановление обрезанного JSON (без mid-string).
- Полный цикл `parseResponse` на фикстуре
  `tests/data/truncated-write_files.json`.
- Фикстура генерируется программно из валидного JSON:
`node tests/data/make-fixture.cjs`. Скрипт создаёт структуру и
обрезает её ровно на два символа (`]}` верхнего уровня) — это
воспроизводит наблюдаемый сбой без риска испортить данные при
копировании из реального ответа модели.

**Когда запускать:** после любой правки
`server-modules/response-parser.js`.

## API-тесты (`api.test.js`)

Запускаются **при работающем сервере**.

```bash
# Терминал 1
npm start

# Терминал 2 (после того как сервер поднялся)
npm run test:api
```

Проверяют:
- `/v1/register`, `/v1/chat/new`, `/v1/context/status`.
- `/v1/chat/completions` — plain, system, multi-turn.
- Tool calling: простая схема (`echo`) и сложная (`write_files`
  с массивом объектов).
- `extra_body.deepthink`, `extra_body.web_search`.
- Upload: одиночный, множественный, `file_id` reference, SVG-картинка.
- Валидацию: 401, 400 (пустой `messages`, неизвестная роль,
  невалидный `tools`, несуществующий `file_id`).
- `/v1/chat/single` (`return_only`, `insert_to_context`).

**Требования:** `tests/config.env`, `tests/data/images/lenna.png`.

## Context-transfer тесты (`context-transfer.test.js`)

Проверяют **перенос контекста** между чатами — то, что нельзя
проверить без реального переполнения.

```bash
npm run test:rag
```

Тест спавнит собственный экземпляр сервера дважды: один раз с
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

## Тесты селекторов (`selectors.test.js`)

Запускаются **без** API-сервера. Открывают Chromium через Playwright,
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

**Требования:** `state.json` (cookies).

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
- Внешние RAG-сценарии с файлами > 10 МБ — требуют времени.

Эти сценарии проверяются вручную, см.
[диагностику](troubleshooting.md).

## Связанные разделы

- [Алгоритмы](../algorithms/index.md) — контрактные описания.
- [Управление сессией](session-management.md) — два лимита,
  деградация, обработка ошибок.
- [Диагностика](troubleshooting.md) — частые проблемы.