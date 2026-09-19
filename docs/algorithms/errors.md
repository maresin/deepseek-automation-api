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
**Дата фиксации:** 2026-09-18
**Версия:** 1

### Назначение

Сигнализировать фатальное состояние: DeepSeek вернул плашку
«Server busy» вместо ответа. Повторные запросы бесполезны.

### Входные данные

- Пустой ответ модели.
- `detectServerBusy()` → true.

### Выходные данные

- HTTP 503 с типом `server_busy`.
- `process.exit(1)` через 500 мс.

### Псевдокод

```
В executePipeline:
  Если response.length === 0:
     serverBusy := detectServerBusy()
     Если serverBusy: throw ServerBusyError()
     Иначе: throw Error("Empty response from DeepSeek")

В chat.js (catch):
  Если err.name === 'ServerBusyError':
     Отправить 503
     setTimeout(() => process.exit(1), 500)
     return
```

### Граничные случаи

- **Плашка есть, ответ непустой.** Невозможно: плашка заменяет ответ.
- **Пустой ответ без плашки.** 500, не shutdown — может быть транзиент.
- **Клиент оборвал соединение.** `process.exit` всё равно сработает.

### Почему именно так

**Почему shutdown, а не retry.** Опыт: после Server Busy DeepSeek
не отвечает часами. Ретраи жгут ресурсы впустую. Остановка передаёт
решение супервизору (systemd, pm2).

**Почему 500 мс перед exit.** Ответ 503 должен успеть дойти до клиента.
Без задержки Node.js завершится до flush'а сокета.

**Почему 503, а не 500.** 503 Service Unavailable семантически точнее:
сервис временно недоступен. Клиент может использовать Retry-After
(хотя мы его не выставляем — таймер неизвестен).

**Почему exit code 1.** Ненулевой код сигнализирует об аварийном
завершении. Без авто-перезапуска сервер останется выключенным —
это желаемое поведение.

### Реализация

- `src/types.ts` → класс
- `src/DeepSeekClient.ts` → `executePipeline()`
- `server-modules/routes/chat.js`

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