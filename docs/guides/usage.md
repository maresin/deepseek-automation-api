# Использование

Практические примеры работы с API. Управление длинными сессиями,
деградация качества и обработка ошибок — в
[Управлении сессией](session-management.md).

## Быстрый старт

### 1. Получить API-ключ

```bash
curl -X POST http://localhost:3000/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

Ответ:
```json
{ "api_key": "deepseek_1700000000_abc123", "message": "Store this API key securely." }
```

### 2. Отправить сообщение

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer deepseek_..." \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Примеры

### System + User

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "system", "content": "Ты говоришь как пират." },
      { "role": "user", "content": "Расскажи шутку." }
    ]
  }'
```

### Multi-turn

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Столица Франции?" },
      { "role": "assistant", "content": "Париж." },
      { "role": "user", "content": "А самый известный музей там?" }
    ]
  }'
```

### Tool calling

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Погода в Москве?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": { "location": { "type": "string" } },
          "required": ["location"]
        }
      }
    }]
  }'
```

Ответ содержит `tool_calls` вместо `content`.

### DeepThink + Web Search

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Объясни квантовую запутанность"}],
    "extra_body": {
      "deepthink": true,
      "web_search": true
    }
  }'
```

### Один файл (multipart)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@document.pdf" \
  -F 'data={"messages":[{"role":"user","content":"Опиши документ"}]}'
```

### Несколько файлов

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -F "files=@file1.pdf" \
  -F "files=@file2.docx" \
  -F "files=@image.jpg" \
  -F 'data={"messages":[{"role":"user","content":"Сравни"}]}'
```

### Файл через file_id

```bash
# 1. Загрузить
FILE_ID=$(curl -s -X POST http://localhost:3000/v1/files \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@document.pdf" | jq -r .id)

# 2. Использовать
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [{
      \"role\": \"user\",
      \"content\": [
        { \"type\": \"text\", \"text\": \"Что в файле?\" },
        { \"type\": \"file\", \"file\": { \"file_id\": \"$FILE_ID\" } }
      ]
    }]
  }"
```

### Новый чат

```bash
# Сбросить контекст (RAG-индекс очищается)
curl -X POST http://localhost:3000/v1/chat/new \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"restore": false}'

# Восстановить последний чат (RAG-индекс сохраняется)
curl -X POST http://localhost:3000/v1/chat/new \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"restore": true}'
```

### Временный чат

```bash
curl -X POST http://localhost:3000/v1/chat/single \
  -H "Authorization: Bearer $API_KEY" \
  -F 'messages=[{"role":"user","content":"Опиши это изображение"}]' \
  -F "file=@image.jpg"
```

Основная сессия не затрагивается — запрос уходит в временный чат,
ответ возвращается клиенту.

---

## Отслеживание контекста

Каждый успешный ответ `/v1/chat/completions` содержит блок
`context_status`. Это единственный способ узнать, что сессия
приближается к лимиту, **до того** как DeepSeek вернёт 409.

```json
{
  "chars_used": 12345,
  "chars_limit": 3000000,
  "percent_used": 0.41,
  "language_mix": { "latin": 0.85, "cyrillic": 0.1, "cjk": 0.05, "other": 0 },
  "language_coefficient": 2.85,
  "deepseek_length_limit": { "detected": false, "readable_percent": null },
  "warning": null,
  "recommendation": null
}
```

### Два лимита, а не один

Система отслеживает **два независимых лимита** одновременно:

| Лимит | Где взять | Что означает |
|---|---|---|
| **Расчётный** | `chars_used / chars_limit` | Наша оценка: `1 000 000 токенов × language_coefficient`. Может расходиться с реальностью на ±20%. |
| **Реальный** | `deepseek_length_limit.readable_percent` | Что DeepSeek **фактически** прочитал. Ground truth. Появляется только в момент переполнения. |

Расчётный лимит выведен из контекстного окна модели
**DeepSeek-V4.1-Flash** (1 048 576 токенов = ~1M) и языкового состава
ваших сообщений:

| Язык | Символов на 1M токенов | Наш лимит | Обоснование |
|---|---|---|---|
| Латиница | ≈ 3 333 333 | 3 000 000 | 0.3 токена на символ; запас ~10% |
| Кириллица | ≈ 2 400 000 | 2 400 000 | 0.42 токена на символ; калибровка на UI |
| CJK | ≈ 1 666 667 | 1 000 000 | 0.6 токена на символ; консервативная оценка |

Чистых языков в реальных сессиях не бывает — коэффициенты смешиваются
пропорционально долям символов. Полный разбор — в
[Управлении сессией](session-management.md).

### Что означает каждое значение

| Поле | Значения | Что делать клиенту |
|---|---|---|
| `percent_used` | 0–100 | Смотреть вместе с `warning`. |
| `warning` | `null` | Всё в порядке. |
| | `"context_above_70"` | Логировать. Готовиться к возможному переходу. |
| | `"context_near_limit"` | Переход планируется на **следующий** запрос. |
| | `"context_limit_reached"` | DeepSeek уже вернул баннер. Следующий запрос получит 409. |
| `recommendation` | `null` | Действий не требуется. |
| | `"monitor"` | Следить за `percent_used` в каждом ответе. |
| | `"transition_to_new_chat"` | Вызвать `POST /v1/chat/new`. |
| `deepseek_length_limit.detected` | `false` | Расчётный и реальный лимиты согласованы. |
| | `true` | **Расчётный лимит завышен.** Смотрите `readable_percent` для калибровки. |

### Рекомендуемый цикл клиента

```python
def chat_with_context_awareness(api_key, messages):
    r = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"messages": messages},
        timeout=180,
    )

    # 409 — расчётный лимит исчерпан (или DeepSeek вернул баннер)
    if r.status_code == 409:
        err = r.json()["error"]
        print(f"Context exhausted: {err['chars_used']} / {err['chars_limit']}")
        print(f"DeepSeek readable: {err['deepseek_readable_percent']}%")
        print(f"RAG preserved: {err['rag_enabled']}")
        print(f"Recovery: {err['recovery']}")

        requests.post(
            f"{BASE_URL}/v1/chat/new",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"restore": False},
        )
        return chat_with_context_awareness(api_key, messages)

    # 503 — DeepSeek backend отказывает. Сервер сам завершится через 500 мс.
    if r.status_code == 503:
        raise RuntimeError("deepseek_server_busy")

    # 401 — ключ невалиден
    if r.status_code == 401:
        raise RuntimeError("invalid_key")

    # 504 — таймаут ожидания ответа
    if r.status_code == 504:
        raise TimeoutError("deepseek_timeout")

    r.raise_for_status()
    data = r.json()

    status = data.get("context_status", {})
    if status.get("warning"):
        print(f"⚠ {status['warning']} → {status['recommendation']}")

    return data["choices"][0]["message"]["content"], data
```

Полный разбор всех кодов, диаграмма состояний и рекомендуемая
архитектура — в [Управлении сессией](session-management.md).

---

## Деградация качества после перехода

Это не ошибка и не баг — это **архитектурное свойство**. Клиент API
обязан его понимать, иначе будет ждать от нового чата того, чего тот
дать не может.

При достижении лимита сервер переходит в новый чат. Модель в новом
чате — это **новый инстанс** без прямого доступа к старому диалогу.
Система передаёт ей только то, что может:

| Механизм | Что передаётся | Что теряется |
|---|---|---|
| Snapshot | Сжатая версия (~10% от лимита) | Всё, что не попало в summary |
| RAG | Top-5 фрагментов, близких к **текущему** запросу | Фрагменты, не относящиеся к теме |
| Оба | Снапшот сразу + RAG по запросу | Снапшот может «задавить» RAG |
| Ни один | Ничего, кроме последнего сообщения | Вся история |

Даже при обоих механизмах модель относится к переданному как к
**документу**, а не как к своей памяти. Это меняет тон, уверенность
и детализацию ответов.

### Что это значит на практике

- После перехода **нельзя** рассчитывать на «помнит всё».
- Критичные факты держите в `system`-сообщении — оно пересылается
  с каждым запросом и переживает любой переход.
- Если после перехода модель «забыла» — переозвучьте факт в новом чате.
- Не полагайтесь на дословное восстановление формулировок.

### Что клиент может сделать

- **Планировать переход** заранее: при `warning = context_above_70`
  сохранять локально всё, что важно.
- **Дублировать контекст** через `system`-сообщение, а не через
  историю `messages`. История может быть урезана при переходе;
  `system` — нет.
- **Переозвучивать** ключевые факты после каждого перехода.
- **Не ждать** от нового чата поведения старого.

---

## Сценарии

### Простой чат (без recovery)

```ini
ENABLE_RESTORE=false
ENABLE_SNAPSHOT=false
ENABLE_RAG=false
```

Контекст **не отслеживается**. При переполнении DeepSeek вернёт баннер,
клиент получит 409. Придётся вручную вызвать `/v1/chat/new` — вся
история будет потеряна. Подходит только для коротких сессий.

### Чат с авто-переходом (snapshot)

```ini
ENABLE_RESTORE=true
ENABLE_SNAPSHOT=true
ENABLE_RAG=false
```

При 70% создаётся снапшот. При 90% — переход в новый чат, снапшот
загружается как файл. Снапшот сжимает историю до ~10% от лимита —
детали теряются, но структура («мы работали над X, цель Y, следующий
шаг Z») сохраняется. Переход автоматический — клиент может его даже
не заметить, но качество ответов после перехода может упасть.

### Чат с памятью (RAG)

```ini
ENABLE_RESTORE=true
ENABLE_SNAPSHOT=false
ENABLE_RAG=true
```

Вся история индексируется. После перехода каждый запрос дополняется
top-5 фрагментами, семантически близкими к текущему вопросу. Память
**избирательная**: найдётся то, что похоже на текущий запрос, а не то,
что «вообще было». Ничего не сжимается — фрагменты передаются дословно.

### Максимум (snapshot + RAG)

```ini
ENABLE_RESTORE=true
ENABLE_SNAPSHOT=true
ENABLE_RAG=true
```

Оба механизма. Снапшот даёт структурную непрерывность, RAG —
тематические детали. Лучший практический результат, но клиент всё
равно обязан понимать, что **даже это** — деградация, а не бесшовное
продолжение.

---

## Интеграция с OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="deepseek_..."
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)
```

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'deepseek_...'
});

const response = await client.chat.completions.create({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'Hello' }]
});
console.log(response.choices[0].message.content);
```

SDK скрывает `context_status` и коды ошибок за стандартными
исключениями. Для продакшена используйте `fetch` / `requests` напрямую —
иначе не сможете отслеживать `warning` и обрабатывать 409.

См. [установку](installation.md), [управление сессией](session-management.md)
и [тестирование](testing.md).

__Примечание:__  
В репозитории есть полный набор примеров на трёх языках — от
регистрации до обработки ошибок. См.
[`examples/`](https://github.com/maresin/deepseek-automation-api/tree/main/examples).

Два вида:

- **Runnable** — Python и JavaScript. Каждый файл запускается
  end-to-end: регистрирует сессию, отправляет запрос, печатает
  ответ. Замените `API_KEY` в начале файла и запустите.
- **Reference** — cURL. Каждый `.sh` файл — последовательность
  полных `curl`-команд. Копируйте по одной в терминал. Файлы не
  предназначены для запуска целиком.

| Файл | Что покрывает |
|---|---|
| `01_getting_started` | Регистрация, health, одно сообщение |
| `02_conversation` | `system` + `user`, multi-turn, tool calling |
| `03_features` | `extra_body.deepthink`, `extra_body.web_search` |
| `04_files` | Multipart `files`, two-phase `file_id`, mixed content |
| `05_session` | Мониторинг контекста, 409 / 503 / 401 / 504, переходы, деградация |

Структура:

```
examples/
├── README.md
├── python/          — 5 файлов, runnable
├── javascript/      — 5 файлов, runnable
└── curl/            — 5 файлов, reference
```

**Обязательно прочитайте `05_session`** перед тем как строить клиент.
Первые четыре примера оптимистичны — они предполагают, что сессия
не переполняется, а сеть надёжна. В реальной работе это не так.
`05` показывает полный клиентский протокол: два лимита, деградацию
после перехода и обработку всех кодов ошибок.