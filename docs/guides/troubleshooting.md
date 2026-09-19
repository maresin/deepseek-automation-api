# Диагностика

## Частые проблемы

### `EADDRINUSE: address already in use :::3000`

**Симптом:** `npm start` падает с `Error: listen EADDRINUSE`.

**Причина:** на порту 3000 уже работает другой процесс — обычно
зависший сервер от предыдущего запуска, или экземпляр, запущенный
тестом `test:rag`.

**Решение:**

```bash
# 1. Найти процесс
lsof -i :3000

# 2. Убить по PID
kill <PID>

# 3. Или, если знаете, что это зависший сервер:
pkill -f "node server.js"

# 4. Проверить, что порт свободен
lsof -i :3000
```

**Частый сценарий.** Запустили `npm start` в одном терминале, потом
случайно запустили его же во втором. Второй процесс падает с
`EADDRINUSE` — но перед падением успевает запустить Chromium
(в версии `server.js` до правки порядка `validateEnvironment`).
После правки (`validateEnvironment` вызывается после `app.listen`)
Chromium больше не стартует при занятом порте.

**Профилактика.** Перед запуском `test:rag` всегда останавливайте
основной сервер:
```bash
pkill -f "node server.js"
npm run test:rag
```

### «Critical selector not found» при старте

**Симптом:** сервер завершается сразу после запуска.

**Причина:** DeepSeek изменил UI, селектор из `Selectors.ts` больше
не соответствует.

**Решение:**
1. Проверьте, какой именно селектор упал (в логе).
2. Откройте DeepSeek в браузере, найдите элемент.
3. Обновите `src/browser/Selectors.ts`.
4. `npm run build && npm start`.

### «eada-cpu not available» (warning)

**Симптом:** в логе предупреждение о `eada-cpu`.

**Решение:** игнорировать. Используется линейный fallback
(`LinearIndex`).

### Долгий первый запрос (2–3 секунды)

**Симптом:** первый запрос с `ENABLE_RAG=true` занимает больше времени.

**Причина:** загружается embedding-модель (Xenova/all-MiniLM-L6-v2).

**Решение:** ожидаемо. Второй и последующие запросы быстрее.

### Браузер открывается при старте

**Симптом:** всплывает окно Chromium.

**Причина:** `DEEPSEEK_HEADLESS=false` или отсутствует `state.json`.

**Решение:** установите `DEEPSEEK_HEADLESS=true`. При первом запуске
браузер откроется для ручного логина.

### «Client not ready» (503)

**Симптом:** `/v1/chat/completions` возвращает 503.

**Причина:** клиент не инициализирован. Возможно:
- Сессия не восстановилась.
- Логин не удался.

**Решение:**
```bash
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

### «Invalid API key» (401)

**Симптом:** 401 при валидном на первый взгляд ключе.

**Причина:** в `state.json` / `.api-key` другой ключ, чем вы используете.

**Решение:** проверьте `.api-key`:
```bash
cat .api-key
```

### Контекст переполняется слишком быстро

**Симптом:** баннер о лимите появляется раньше, чем ожидалось.

**Причина:** языковой коэффициент занижен (для латиницы 3.0, но
текст может содержать редкие символы).

**Решение:** проверьте `context_status.language_coefficient` в
ответе. Если он < 2.0 для латиницы — пришлите пример, нужно
калибровать.

### RAG не находит ничего

**Симптом:** `RAG search returned 0 result(s)`.

**Причины:**
- `ENABLE_RAG=false`.
- Сессия новая, индекс пуст.
- Только что загруженные файлы ещё индексируются (фоново).
- `chatId` не присвоен (см. R5).

**Решение:**
```bash
ls rag_data/
cat rag_data/<key>.linear.json | jq '.items | length'
```

### RAG-контекст не помогает

**Симптом:** модель отвечает «файла нет» на RAG-файлы.

**Причина:** System-инструкция не была инъектирована (см. R8).

**Решение:** проверьте лог на `RAG instruction injected as System message`.

### Snapshot не создаётся

**Симптом:** при 70% снапшот не появляется.

**Причины:**
- `ENABLE_SNAPSHOT=false`.
- `snapshot70Done=true` (уже создан, перезапишется на 90%).
- Модель вернула пустоту.

**Решение:**
```bash
ls uploads/snapshot.txt
curl http://localhost:3000/v1/context/status -H "Authorization: Bearer $KEY"
```

### Файл не загружается

**Симптом:** `File badge did not appear within 30s`.

**Причины:**
- Формат не поддерживается DeepSeek.
- Размер > 100 MB.
- Плашка «Server busy».

**Решение:** проверьте расширение и размер. Если формат поддерживается —
посмотрите лог на `retries`. После 5 попыток бейдж остался в ошибке.

### Слишком много «Server busy» ошибок

**Симптом:** частое `ServerBusyError`.

**Причина:** DeepSeek backend отказывает.

**Решение:** сервер сам завершится. Перезапустите через 1–2 часа.

### 409 (context_exhausted) в неожиданный момент

**Симптом:** 409 на запрос, который должен помещаться.

**Причины:**
- Языковой коэффициент слишком высокий (низкий лимит).
- `totalChars` завышен из-за множителя DeepThink.

**Решение:** проверьте `chars_used` / `chars_limit` в теле 409.

```bash
ENABLE_SNAPSHOT=false ENABLE_RAG=false npm start
```

Без recovery-режимов баннер вернётся как 409 — вы увидите реальные
цифры.

## Логи

Основные сообщения:

| Лог | Значение |
|---|---|
| `📥 POST /v1/chat/completions` | Запрос принят |
| `📎 File(s) attached: ...` | Файлы прикреплены |
| `📚 RAG search returned N result(s)` | Поиск по индексу |
| `📚 RAG context written to file: ...` | RAG-контекст записан |
| `🌍 Language mix: {...}` | Анализ языка |
| `📏 Context size: N / M chars (P%)` | Текущий размер |
| `📸 Context reached P%, creating snapshot...` | Создание снапшота |
| `🔄 handleOverflow: snapshot=..., rag=...` | Переход |
| `✅ Response sent in Nms` | Успешный ответ |
| `🚫 DeepSeek server busy — shutting down` | ServerBusyError |
| `❌ Chat route error:` | Необработанная ошибка |

## Перезапуск с нуля

```bash
npm run clean
npm start
```

Удаляет `state.json`, `chat_state.json`, `.api-key`, `uploads/`,
`rag_data/`. Требуется повторная регистрация.

## Диагностические команды

```bash
# Здоровье
curl http://localhost:3000/health

# Контекст
curl http://localhost:3000/v1/context/status \
  -H "Authorization: Bearer $KEY"

# Размер индекса
cat rag_data/<key>.linear.json | jq '.items | length'

# Список временных файлов
ls -la uploads/

# Содержимое chat_state
cat chat_state.json | jq

# Содержимое state (только cookies)
cat state.json | jq '.cookies | length'
```

## Когда писать issue

Приложите:
1. Версию Node.js (`node --version`).
2. Содержимое `.env` (без паролей).
3. Фрагмент лога (несколько строк вокруг ошибки).
4. Ответ `/v1/context/status`.
5. Размер `rag_data/` (если RAG включён).

См. [тестирование](testing.md) и [алгоритмы/ошибки](../algorithms/errors.md).