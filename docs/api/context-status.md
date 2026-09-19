# API: context_status

Поле `context_status` присутствует в ответе `/v1/chat/completions`.
Оно не входит в спецификацию OpenAI и добавлено для мониторинга.

## Формат

```json
{
  "chars_used": 12345,
  "chars_limit": 3000000,
  "percent_used": 0.41,
  "language_mix": {
    "latin": 0.85,
    "cyrillic": 0.1,
    "cjk": 0.05,
    "other": 0
  },
  "language_coefficient": 2.85,
  "deepseek_length_limit": {
    "detected": false,
    "readable_percent": null
  },
  "warning": null,
  "recommendation": null
}
```

## Поля

| Поле | Описание |
|---|---|
| `chars_used` | Текущий размер контекста (символы, оценка) |
| `chars_limit` | Динамический лимит (символы, оценка) |
| `percent_used` | `chars_used / chars_limit * 100` (с точностью 0.1) |
| `language_mix` | Доли языков в первых 500–5000 символах |
| `language_coefficient` | «Символов на токен» для текущей смеси |
| `deepseek_length_limit.detected` | Баннер о лимите был обнаружен |
| `deepseek_length_limit.readable_percent` | Процент из баннера (`first N%`), если есть |
| `warning` | `null` / `context_above_70` / `context_near_limit` / `context_limit_reached` |
| `recommendation` | `null` / `monitor` / `transition_to_new_chat` |

## Как читать

- `percent_used < 70` — всё в порядке, `warning = null`.
- `70 ≤ percent_used < 90` — `warning = context_above_70`. Снапшот создан
  (если `ENABLE_SNAPSHOT=true`). Продолжайте работу.
- `percent_used ≥ 90` — `warning = context_near_limit`. Переход запланирован
  на следующий запрос.
- `deepseek_length_limit.detected = true` — DeepSeek уже вернул баннер.
  Клиент получил HTTP 409.

## Пример: клиент отслеживает контекст

```javascript
const response = await fetch('/v1/chat/completions', { ... });
const data = await response.json();

if (response.status === 409) {
  // Контекст исчерпан
  const info = data.error;
  console.log(`Limit reached at ${info.chars_used}/${info.chars_limit}`);
  console.log(`DeepSeek readable: ${info.deepseek_readable_percent}%`);
  console.log(`RAG enabled: ${info.rag_enabled}`);
  console.log(`Recovery: ${info.recovery}`);

  // Переход в новый чат
  await fetch('/v1/chat/new', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ restore: false })
  });
} else {
  const status = data.context_status;
  if (status.percent_used > 70) {
    console.warn(`Context at ${status.percent_used}% — prepare for transition`);
  }
}
```

## Почему поле добавлено

Клиент должен иметь возможность:
1. **Мониторить** приближение к лимиту (для собственной логики).
2. **Принимать решение** о переходе (какой сценарий использовать).
3. **Диагностировать** языковой коэффициент (если ответы неожиданно
   обрезаются, возможно, `language_coefficient` занижен).

Без `context_status` клиент видит только 409 и не понимает,
почему он возник и что делать.

См. [endpoints](endpoints.md) и [algorithms/context](../algorithms/context.md).