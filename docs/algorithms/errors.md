# Обработка ошибок

Алгоритмы E1–E4 описывают обнаружение, классификацию и трансляцию
ошибок в HTTP-ответы.

---

## E1. ContextExhaustedError {#e1}
**Статус:** active
**Дата фиксации:** 2026-09-18
**Версия:** 2 (заменил NeedTransitionError)

### Назначение

Сигнализировать, что DeepSeek достиг лимита контекста текущего чата.
Передать клиенту достаточно данных для принятия решения о переходе.

### Входные данные

- `bannerText: string` — текст баннера от DeepSeek.
- `partialResponse: string` — то, что успело сгенерироваться.

### Выходные данные

- Исключение `ContextExhaustedError` с полями:
  - `chatId`, `charsUsed`, `charsLimit`
  - `deepseekReadablePercent`
  - `partialResponse`, `ragEnabled`, `bannerText`
- HTTP 409 с типом `context_exhausted`.

### Псевдокод

```
В executePipeline:
  try:
     response := waitForFullResponse(lastKey)
  catch err:
     Если err instanceof ContextExhaustedError:
        err.chatId := currentChatId
        err.charsUsed := contextManager.totalChars
        err.charsLimit := contextManager.getDynamicMaxChars()
        err.ragEnabled := ENABLE_RAG === 'true'
        parsed := detectLengthLimit()
        err.deepseekReadablePercent := parsed.percent
        needTransition := true
     throw err

В chat.js (catch):
  Если err.name === 'ContextExhaustedError':
     Отправить 409 с полным описанием и recovery-инструкцией.
     recovery := 'POST /v1/chat/new' + (ragEnabled ? ' (index preserved)' : ' (history lost)')
```

### Граничные случаи

- **Баннер найден без процентов.** `deepseekReadablePercent = null`.
- **Partial response пуст.** Возвращается пустая строка.
- **RAG выключен.** В recovery указывается, что контекст будет потерян.

### Почему именно так

**Почему 409, а не 500.** 409 Conflict точнее: запрос конфликтует с
текущим состоянием сессии. 500 подразумевает ошибку сервера, 409 —
необходимость изменить запрос.

**Почему recovery в теле ответа.** Клиент должен понимать, что
делать дальше. Явная инструкция `POST /v1/chat/new` + объяснение
судьбы RAG-индекса снимает догадки.

**Почему флаг `ragEnabled` в ошибке.** Без него клиент не знает,
сохранён ли старый контекст. Это влияет на решение — можно ли
продолжать ту же тему.

**Почему заменил `NeedTransitionError`.** Раньше было два исключения:
одно для баннера, другое для программного триггера. После унификации
достаточно одного — `needTransition` живёт как поле клиента, а не
как отдельный класс ошибки.

### Реализация

- `src/types.ts` → класс
- `src/DeepSeekClient.ts` → `executePipeline()`
- `server-modules/routes/chat.js` → обработчик

---

## E2. ServerBusyError {#e2}

**Статус:** active
**Дата фиксации:** 2026-10-20
**Версия:** 2 (retry вместо shutdown)

### Назначение

Сигнализировать, что все попытки получить ответ от DeepSeek исчерпаны:
бэкенд отвечает плашкой «server busy» (или его аналогом) либо
возвращает пустой ответ без маркеров. По умолчанию агент при этом
**не завершается** — следующая попытка клиента может пройти через
несколько минут.

### Входные данные

- Пустой ответ модели.
- Результат детекта `detectServerBusy()` → `busy` или `empty`.
- Параметры retry из `.env`:
  - `DEEPSEEK_BUSY_MAX_RETRIES` (default 3)
  - `DEEPSEEK_BUSY_DELAY_MS` (default 300000 = 5 минут)
  - `DEEPSEEK_SHUTDOWN_ON_SERVER_BUSY` (default false)

### Выходные данные

- HTTP 503 с телом:
  ```json
  {
    "error": {
      "type": "server_busy",
      "kind": "busy" | "empty",
      "attempts": 4,
      "retry_after_seconds": 300,
      "message": "..."
    }
  }
  ```
- Заголовок `Retry-After: <секунды>`.
- `process.exit(1)` через 500 мс — **только** если
  `DEEPSEEK_SHUTDOWN_ON_SERVER_BUSY=true`.

### Псевдокод

```
executePipeline(options):
  maxRetries := env DEEPSEEK_BUSY_MAX_RETRIES (default 3)
  busyDelayMs := env DEEPSEEK_BUSY_DELAY_MS   (default 300000)
  emptyDelayMs := 15000                        (15 секунд)
  maxAttempts := maxRetries + 1

  Для attempt = 1 .. maxAttempts:
    result := executePipelineOnce(options)

    Если result.kind == 'ok':     вернуть result.response
    Если result.kind == 'banner': вернуть ''  // caller обрабатывает

    delay := result.kind == 'busy' ? busyDelayMs : emptyDelayMs
    Если attempt >= maxAttempts:
        throw ServerBusyError({kind: result.kind, attempts: attempt})

    Логировать "retry N/M в delay секунд"
    sleep(delay)

В chat.js (catch):
  Если err.name == 'ServerBusyError':
    Отправить 503 с kind, attempts, Retry-After
    Если DEEPSEEK_SHUTDOWN_ON_SERVER_BUSY == 'true':
        setTimeout(() => process.exit(1), 500)
```

### Граничные случаи

- **`DEEPSEEK_BUSY_MAX_RETRIES=0`.** Retry отключён, первая же пустая
  попытка → 503. Для интерактивных приложений, где клиент не может
  держать соединение 15+ минут.
- **`DEEPSEEK_BUSY_DELAY_MS` очень маленький.** Риск: DeepSeek всё
  равно вернёт busy, потому что cooldown не выдержан. Дефолт 5 минут —
  эмпирический минимум.
- **Retry успешен на 2-й/3-й попытке.** Клиент получает нормальный
  ответ, без признаков в теле. Только в логе сервера видно `retry N/M`.
- **Плашка появилась после успешной генерации.** Не относится к
  `ServerBusyError` — это ранняя проверка `detectBanner`, которая
  возвращает `{kind: 'banner'}` и обрабатывается через
  `ContextExhaustedError` (см. E1).
- **Файлы прикреплены к запросу.** Retry не перезагружает файлы —
  первая попытка их «съедает». Если запрос с файлами и включён retry,
  второй запрос уйдёт без вложения. Рекомендация в документации:
  `DEEPSEEK_BUSY_MAX_RETRIES=0` для запросов с файлами.

### Почему именно так

**Почему retry, а не мгновенный shutdown.** Раньше (`v1`) агент
завершался на первой же плашке — политика «после Server Busy DeepSeek
не отвечает часами, лучше перезапустить процесс». Для автономных
агентов это плохо: одна плашка убивает весь сервис, а следующий
запрос через минуту мог бы пройти. Retry даёт шанс пережить
временное состояние без потери состояния.

**Почему дефолтная задержка 5 минут.** DeepSeek реально требует
несколько минут cooldown. Меньшие интервалы (30–60 секунд) не дают
эффекта: плашка возвращается. 5 минут — минимальная эмпирическая
величина, при которой retry имеет смысл.

**Почему `Retry-After` в 503.** Если retry исчерпаны, клиент должен
знать, через сколько повторить. Значение берётся из
`DEEPSEEK_BUSY_DELAY_MS`, то есть совпадает с внутренней политикой
сервера. Клиент может поставить свою паузу, но ориентир есть.

**Почему shutdown остался opt-in.** Старая семантика («убить процесс
на busy») разумна, когда супервизор поднимает агента за секунды.
Оставили её через `DEEPSEEK_SHUTDOWN_ON_SERVER_BUSY=true` — теперь
это осознанный выбор, а не поведение по умолчанию.

**Почему `empty` и `busy` различаются.** В обоих случаях ответ пустой,
но `busy` — явный сигнал DeepSeek («подожди 5 минут»), а `empty` —
неизвестный сбой. Для `busy` длинная пауза, для `empty` короткая
(15 секунд): если проблема была транзиентной (таймаут сети, короткий
глюк), длинная пауза только зря блокирует клиента.

### Реализация

- `src/types.ts` → `BusyKind`, `ServerBusyError({ kind, attempts })`
- `src/DeepSeekClient.ts` → `executePipeline` (retry loop),
  `executePipelineOnce` (single pass)
- `src/chat/ResponseExtractor.ts` → `detectServerBusy()` (обе
  формулировки)
- `src/browser/Selectors.ts` → `serverBusyPattern`,
  `retryButtonPathPrefix`
- `server-modules/routes/chat.js` → 503 + `Retry-After` + условный
  shutdown

### История

- v1 (2026-09-18): `ServerBusyError` → HTTP 503 → shutdown после 500 мс.
- v2 (2026-10-20): retry с настраиваемой задержкой; shutdown стал
  opt-in; `Retry-After`; различение `busy` / `empty`.

---

## E3. Валидация запросов {#e3}
**Статус:** active
**Дата фиксации:** 2026-09-18
**Версия:** 1

### Назначение

Отсеивать некорректные запросы до обращения к DeepSeek. Экономит
бюджет времени (каждый запрос — 15–30 секунд).

### Входные данные

- `messages: any[]`.
- `tools: any[] | undefined`.
- `extra_body: object | undefined`.

### Выходные данные

Текст ошибки или null. При наличии ошибки — HTTP 400.

### Псевдокод

```
validateMessages(messages):
  Если !Array.isArray: вернуть "messages must be an array"
  Если length === 0:  вернуть "messages cannot be empty"
  Для каждого msg:
     Если !object:              вернуть "each message must be an object"
     Если role не в {user, assistant, system}:
                                вернуть "Invalid role"
     Если typeof content не string и не array:
                                вернуть "Invalid content type"
  Вернуть null

validateTools(tools):
  Если undefined: вернуть null
  Если !Array.isArray: вернуть "tools must be an array"
  Для каждого tool:
     Если tool.type !== 'function': вернуть "Invalid tool type"
     Если !tool.function?.name:     вернуть "missing function.name"
  Вернуть null

validateExtraBody(extra_body):
  Если undefined: вернуть null
  Если typeof !== 'object' или null или array:
     вернуть "extra_body must be an object"
  Вернуть null
```

### Граничные случаи

- **Пустой массив messages.** Отклоняется.
- **Неизвестная роль.** Отклоняется.
- **Content как массив.** Разрешён, обрабатывается отдельно
  (`extractTextFromMessages`).

### Почему именно так

**Почему валидация до вызова DeepSeek.** Каждый валидный запрос
тратит 15–30 секунд и ресурсы браузера. Отсев на уровне HTTP —
бесплатен и быстр.

**Почему content допускает массив.** OpenAI-совместимость: клиенты
могут присылать `[{type: 'text', text: '...'}, {type: 'file', ...}]`.
Это валидный формат, обрабатывается в `extractTextFromMessages`.

**Почему нет строгой схемы (zod/joi).** Проект намеренно минимален
по зависимостям. Ручные проверки покрывают реальные случаи.

### Реализация

- `server-modules/routes/chat.js` → `validateMessages()`, `validateTools()`, `validateExtraBody()`

---

## E4. Трансляция ошибок в HTTP {#e4}
**Статус:** active
**Дата фиксации:** 2026-09-18
**Версия:** 1

### Назначение

Преобразовать исключения в осмысленные HTTP-коды и тела ответов.

### Входные данные

- Пойманное исключение `err`.

### Выходные данные

HTTP-ответ соответствующего статуса.

### Псевдокод

```
catch err:
  Если err.name === 'ContextExhaustedError': 409 + recovery
  Если err.name === 'ServerBusyError':       503 + exit(1)
  Если message содержит "request too large": 400
  Если err.name === 'TimeoutError' или "timeout": 504
  Иначе: 500 с err.message
```

### Граничные случаи

- **Headers уже отправлены.** Не пытаться отправить ответ повторно.
- **Неизвестная ошибка.** 500 с текстом.

### Почему именно так

**Почему 409/503/400/504, а не всё 500.** Клиент должен различать:
- 400 — переделать запрос.
- 409 — нужна новая сессия.
- 503 — сервер недоступен, retry позже.
- 504 — таймаут, возможно, стоит повторить.

Один 500 на все случаи не даёт клиенту никакой информации.

**Почему проверка `headersSent`.** Если ошибка произошла после
начала отправки ответа, повторный `res.json` выбросит
«Cannot set headers after they are sent». Проверка предотвращает это.

### Реализация

- `server-modules/routes/chat.js`

---

## Журнал замен

| Алгоритм | Версия | Дата | Что изменилось |
|---|---|---|---|
| E1 | 1 → 2 | 2026-09-18 | Заменён NeedTransitionError на ContextExhaustedError |
| E2 | 1 | 2026-09-18 | Первичная фиксация |
| E3 | 1 | 2026-09-18 | Первичная фиксация |
| E4 | 1 | 2026-09-18 | Первичная фиксация |