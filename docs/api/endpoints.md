# API: эндпоинты

DeepSeek Automation API следует спецификации OpenAI везде, где это
применимо. Ниже — полный список эндпоинтов.

## POST /v1/register

Создаёт сессию и возвращает API-ключ.

**Body (JSON):**
```json
{ "email": "user@example.com", "password": "secret" }
```

**Ответ 200:**
```json
{ "api_key": "deepseek_...", "message": "Store this API key securely." }
```

**Особенности:**
- Если сессия уже существует — возвращает существующий ключ.
- Если `.env` содержит `DEEPSEEK_EMAIL` / `DEEPSEEK_PASSWORD`, сервер
  может зарегистрироваться автоматически при старте.
- При `ENABLE_RAG=true` создаётся (и очищается) RAG-индекс для сессии.

---

## POST /v1/chat/completions

Основной эндпоинт. OpenAI-совместимый.

**Headers:**
```
Authorization: Bearer <api_key>
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "tools": [...],              // опционально
  "extra_body": {              // опционально
    "deepthink": true,
    "web_search": true
  }
}
```

**Body (multipart, файлы):**
```
data=<json>
file=<binary>       (опционально, 1)
files=<binary>      (опционально, до 50)
```

**Ответ 200:**
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "deepseek-chat",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "..." },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 10, "completion_tokens": 50, "total_tokens": 60 },
  "context_status": {
    "chars_used": 1234,
    "chars_limit": 2400000,
    "percent_used": 0.05,
    "language_mix": { "latin": 1, "cyrillic": 0, "cjk": 0, "other": 0 },
    "language_coefficient": 3.0,
    "deepseek_length_limit": { "detected": false, "readable_percent": null },
    "warning": null,
    "recommendation": null
  }
}
```

**Ответ 200 (tool call):**
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_...",
        "type": "function",
        "function": { "name": "get_weather", "arguments": "{\"location\":\"Moscow\"}" }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```
> **Нормализация tool_calls.** Сервер всегда возвращает
> OpenAI-совместимый формат независимо от того, как модель оформила
> ответ. Если модель обернула JSON в markdown-обёртку или добавила
> преамбулу, сервер извлекает `tool_calls` через балансировку скобок.
> Если `arguments` пришли строкой — проходят verbatim; если объектом —
> сериализуются один раз. См. алгоритм
> [B8](../algorithms/response.md#b8).

**Ответ 400:** невалидные messages / tools / extra_body.

**Ответ 409:** достигнут лимит контекста. Тело:
```json
{
  "error": {
    "type": "context_exhausted",
    "message": "DeepSeek context limit reached",
    "chat_id": "...",
    "chars_used": 2345678,
    "chars_limit": 2400000,
    "deepseek_readable_percent": 75,
    "partial_response": "...",
    "banner_text": "Length limit reached...",
    "rag_enabled": true,
    "recovery": "Call POST /v1/chat/new to start a new session..."
  }
}
```

**Ответ 503:** DeepSeek Server Busy. Сервер завершится через 500 мс.
```json
{
  "error": {
    "type": "server_busy",
    "message": "DeepSeek backend is not responding. Server shutting down."
  }
}
```

**Ответ 504:** таймаут ожидания ответа.

---

## POST /v1/chat/new

Создаёт новый чат (или восстанавливает предыдущий).

**Body:**
```json
{ "restore": false }
```

- `restore: false` — новый чат, RAG-индекс очищается.
- `restore: true` — восстановить последний чат из `chat_state.json`,
  RAG-индекс сохраняется.

**Ответ 200:**
```json
{ "success": true, "restore": false }
```

**Ответ 409:** restore не удался.
```json
{
  "error": {
    "type": "restore_failed",
    "reason": "chat_not_found",
    "message": "The last chat session could not be found...",
    "state_cleared": true
  }
}
```

---

## POST /v1/chat/single

Запрос во временном чате. Основная сессия не затрагивается.

**Body (multipart):**
```
messages=<json>
file=<binary>              (опционально)
insert_to_context=true     (опционально)
return_only=true           (опционально)
```

**Ответ 200:**
```json
{ "success": true, "answer": "...", "inserted": false }
```

При `return_only=true`:
```json
{ "answer": "..." }
```

**Особенности:**
- Временный чат создаётся и удаляется автоматически.
- При `insert_to_context=true` ответ добавляется в основной чат как
  System-сообщение.

---

## POST /v1/files

Загрузка файла (OpenAI file API).

**Body (multipart):**
```
file=<binary>
purpose=assistants          (опционально)
```

**Ответ 200:**
```json
{
  "id": "file_...",
  "object": "file",
  "bytes": 12345,
  "created_at": 1234567890,
  "filename": "document.pdf",
  "purpose": "assistants"
}
```

**Использование file_id в messages:**
```json
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "Summarize this" },
      { "type": "file", "file": { "file_id": "file_..." } }
    ]
  }]
}
```

**Ответ 400:** неподдерживаемый формат / пустой файл / размер > 100 MB.

---

## GET /v1/context/status

Внутренний эндпоинт для отладки контекста.

**Ответ 200:**
```json
{
  "totalChars": 123456,
  "maxChars": 3000000,
  "percent": 4,
  "snapshot70Done": false,
  "snapshot90Done": false
}
```

---

## GET /health

Health check.

**Ответ 200:**
```json
{ "status": "ok", "timestamp": "2026-09-18T18:57:24.037Z" }
```

---

## Rate limits

| Группа | Лимит |
|---|---|
| Глобально | 100 запросов/мин |
| Chat completions | 30 запросов/мин |
| File upload | 10 запросов/мин |

## Аутентификация

Все эндпоинты, кроме `/v1/register` и `/health`, требуют:

```
Authorization: Bearer <api_key>
```

Неверный ключ → 401. Клиент не инициализирован → 503.

См. [context-status](context-status.md).