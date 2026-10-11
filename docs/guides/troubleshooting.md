# Диагностика

## Частые проблемы

### `EADDRINUSE: address already in use :::3000`

**Симптом:** `npm start` падает с `Error: listen EADDRINUSE`.

**Причина:** на порту 3000 уже работает другой процесс — обычно
зависший сервер от предыдущего запуска или экземпляр, запущенный
тестом `test:rag`.

**Решение (кроссплатформенное):**

```bash
npx kill-port 3000
```

Работает одинаково на Linux, macOS и Windows. Команда находит
процесс по порту и убивает его.

**Проверка, что порт свободен:**

```bash
curl http://localhost:3000/health
# connection refused
```

### Платформенные альтернативы

**Linux / macOS:**

```bash
lsof -i :3000      # найти PID
kill <PID>         # убить процесс
```

**Windows (PowerShell):**

```powershell
Get-NetTCPConnection -LocalPort 3000 |
  Select-Object -ExpandProperty OwningProcess
Stop-Process -Id <PID> -Force
```

**Windows (cmd):**

```cmd
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Осторожно с `pkill -f "node server.js"` и `taskkill /IM node.exe`.**
Оба убивают всё, что подходит под шаблон. `pkill` затронет все
процессы `node server.js` на машине (включая другие ваши проекты,
если они запускаются той же командой). `taskkill /IM node.exe`
вообще убивает **все** Node-процессы. Используйте только если
уверены, что других таких процессов нет.

**Профилактика.** Перед запуском `test:rag` останавливайте основной
сервер:

```bash
npx kill-port 3000
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

### «Skipping state write» в логах при старте

**Симптом:** при запуске в логе появляется

```
💾 Skipping state write: file is newer (mtime ... > ...)
```

**Причина:** два процесса используют общий `DEEPSEEK_STATE_PATH`.
Один из них записал состояние после того, как второй прочитал файл.
mtime-guard предотвращает перезапись более свежего слепка старым.

**Решение:** ничего делать не нужно. Это корректное поведение.
Подробности — в [A6](../algorithms/session.md#a6) и в разделе
«Общий state.json» в [Построении приложений](building-applications.md).

### Браузер открывается при старте

**Симптом:** всплывает окно Chromium.

**Причина:** `DEEPSEEK_HEADLESS=false` или отсутствует `state.json`.

**Решение:** установите `DEEPSEEK_HEADLESS=true`. При первом запуске
браузер откроется для ручного логина.

### «Client not ready» (503)

**Симптом:** `/v1/chat/completions` возвращает 503 сразу после старта.

**Причина:** HTTP-сервер уже слушает, но `DeepSeekClient.initialize()`
ещё не завершился. Клиент поднимается за 15–30 секунд: launch
Chromium, навигация, проверка селекторов.

**Решение:** подождать. В мультиагентных сценариях
`tools/make-multi-agent.sh` генерирует `scripts/start-all.sh`,
который поллит `/v1/context/status` до готовности — эта проблема
там не возникает. Если пишете свой скрипт запуска — проверяйте
`/v1/context/status`, не `/health`.

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

### `make-multi-agent.sh` говорит, что `state.json` не найден

**Симптом:** после запуска `tools/make-multi-agent.sh` выводится:

```
✗ No /path/to/deepseek-automation-api/state.json found.
```

**Причина:** API ещё ни разу не запускался в этом окружении, либо
файл был удалён.

**Решение:** запустите API один раз, войдите в DeepSeek через браузер,
остановите. После этого `state.json` появится в корне проекта.

```bash
cd /path/to/deepseek-automation-api
npm start
# ... логин в браузере, капча
# Ctrl+C
```

Теперь сборщик сработает.

---

## Проблемы с регистрацией DeepSeek

Если автоматизированный Chromium входит в бесконечный цикл капчи
Cloudflare — правильные ответы отклоняются, потому что trust score
браузера ниже порога. Есть два пути решения.

### Recipe 1 — удаление и перерегистрация аккаунта

**Когда помогает.** Проблема именно в аккаунте: Cloudflare пометил
конкретный аккаунт как подозрительный.

**Когда не помогает.** Проблема в браузере или IP: новый аккаунт с
того же браузера и IP столкнётся с теми же проверками.

**Процесс:**

1. Откройте `chat.deepseek.com` в **обычном** браузере (Firefox).
2. Войдите — если получится, значит проблема была в automated browser,
   используйте Recipe 2 вместо этого.
3. Откройте **Settings → Profile**.
4. Прокрутите вниз до **Delete account**.
5. Удалите аккаунт. Подтверждение обычно через email-код.
6. Дождитесь полного удаления (может занять час-два).
7. Зарегистрируйте **новый аккаунт** с **другого email**.
8. Первый логин сделайте с той машины, где будет работать
   автоматизация, чтобы fingerprint был «связан» с новым аккаунтом.

> **Важное замечание.** Cloudflare запоминает fingerprint устройств
> на 30–90 дней. Если текущий Chromium уже был помечен как
> «automated», даже новый аккаунт может ловить капчу. В этом случае
> помогает комбинация: удалить `browsers/`, переустановить Chromium
> (`npx playwright install chromium`), сменить IP (мобильный хотспот),
> потом Recipe 1.

### Recipe 2 — перенос куки из обычного браузера

**Когда помогает.** Аккаунт в порядке, но Playwright не может
залогиниться из-за капчи. Это самый чистый путь для автоматизации.

**Идея.** Логин происходит в обычном Firefox, где Cloudflare доверяет
браузеру. Куки экспортируются расширением Cookie-Editor и
конвертируются в формат Playwright.

**Процесс:**

1. Установите Firefox (если ещё нет) и зайдите на `chat.deepseek.com`.
2. Войдите логином/паролем, пройдите капчу — в обычном браузере она
   проходит быстро.
3. Установите расширение **Cookie-Editor** (Firefox / Chrome).
4. На странице `chat.deepseek.com`: Cookie-Editor → **Export → JSON**,
   сохраните в `/tmp/cookies.json`.
5. Конвертируйте в формат Playwright:

   ```bash
   cd /path/to/deepseek-automation-api
   python3 tools/cookies-to-state.py /tmp/cookies.json state.json
   ```

   Скрипт проверит наличие `cf_clearance` — куки Cloudflare pass
   token. Если её нет, конвертация предупредит, и надо вернуться к
   шагу 2: возможно, страница ещё не прошла challenge.

6. Запустите API обычным образом:

   ```bash
   DEEPSEEK_HEADLESS=true DEEPSEEK_EMAIL= DEEPSEEK_PASSWORD= npm start
   ```

   Пустые email/password — сознательно. Если куки валидны, логина не
   будет. Если невалидны — сервер не полезет в капчу, а сразу упадёт
   с понятной ошибкой.

7. Проверьте, что API работает:

   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Authorization: Bearer $(cat .api-key)" \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"ping"}]}'
   ```

8. Если API отвечает — можно создавать мультиагентный деплой через
   `tools/make-multi-agent.sh` или обновлять существующий:

   ```bash
   cd /path/to/my-project/deepseek-agents
   ./scripts/refresh-state.sh
   ./scripts/start-all.sh
   ```

### Чего не делать

- **Не пытайтесь решать капчу в цикле.** Правильные ответы,
  отправленные с низким trust score, будут отклоняться. Каждая
  неудачная попытка ухудшает ситуацию.
- **Не используйте сторонние captcha-сервисы** (2captcha, CapSolver).
  Turnstile сложнее, чем hCaptcha; даже если сервис справится с
  челленджем, trust score останется низким, и логин упадёт на
  следующем шаге.
- **Не воюйте с автоматизацией через `--disable-blink-features` и
  подобное.** Turnstile смотрит на десятки сигналов помимо
  `navigator.webdriver`, старые трюки не работают.

---

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
| `💾 State file: ...` | Resolved путь к state.json при старте |
| `💾 State saved (N cookies, mtime ...)` | Успешная запись state |
| `💾 Skipping state write ...` | Guard предотвратил перезапись |

## Перезапуск с нуля

```bash
npm run clean
npm start
```

Удаляет `state.json`, `chat_state.json`, `.api-key`, `uploads/`,
`rag_data/`. Требуется повторная регистрация.

> **Важно.** `npm run clean` удаляет файлы только по путям по умолчанию.
> Если вы переопределили `DEEPSEEK_STATE_PATH`,
> `DEEPSEEK_CHAT_STATE_PATH`, `DEEPSEEK_API_KEY_PATH`,
> `DEEPSEEK_UPLOAD_DIR` или `RAG_DATA_DIR`, удалите файлы вручную —
> команда их не тронет.

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