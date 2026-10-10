# Построение приложений на API

Практическое руководство для тех, кто использует DeepSeek Automation API
как backend для своего приложения — от простого чат-клиента до
мультиагентной системы.

Документ отвечает на четыре вопроса:

- Как устроена сессия и что клиент может с ней делать.
- Как построить одноагентное приложение.
- Как построить мультиагентное приложение на нескольких процессах.
- Что делать, когда автоматизированный браузер ловит капчу.

Перед чтением: [Управление сессией](session-management.md) — что такое
сессия, два лимита, деградация после перехода.

---

## Что API предоставляет клиенту

Один запущенный процесс — это **одна сессия**: один Chromium, одна
активная страница, один чат, один `chat_state.json`. API сознательно
не пытается эмулировать многопоточность внутри одного процесса.

| Что можно | Что нельзя |
|---|---|
| Отправить сообщение в текущий чат | Работать с несколькими чатами одновременно |
| Начать новый чат (`/v1/chat/new {restore:false}`) | Переключиться на конкретный чат по id |
| Восстановить последний чат (`restore:true`) | Узнать id текущего чата через API |
| Запросить статус контекста (`/v1/context/status`) | Разделить контекст между чатами |

Это ограничение **архитектурное**, не временное. DeepSeek Web — один
браузер, одна активная страница. Даже если бы API умел переключаться
между чатами, параллельной работы не получилось бы: UI-операции всё
равно сериализуются через `TaskQueue` (см.
[Q1](../algorithms/queues.md#q1)).

Практический вывод: **если нужно N независимых чатов — нужно N
процессов**.

---

## Одноагентное приложение

Самый простой случай. Один процесс, один клиент, одна сессия.

### Схема

```
Клиент ──HTTP──> localhost:3000 ──Playwright──> DeepSeek Web
```

### Запуск

```bash
npm start
```

Порт, ключ и пути берутся из `.env`. После первого запуска клиент
читает `.api-key` и использует его во всех запросах.

### Цикл работы

```python
import requests
from pathlib import Path

BASE_URL = "http://localhost:3000"
API_KEY = Path(".api-key").read_text().strip()

def ask(content):
    r = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"messages": [{"role": "user", "content": content}]},
        timeout=300,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

print(ask("Hello"))
```

### Что нужно обрабатывать

Один агент работает долго — контекст накапливается. Клиент обязан
следить за `context_status` в каждом ответе и корректно реагировать
на четыре сигнала:

| Сигнал | Действие клиента |
|---|---|
| `warning: "context_above_70"` | Логировать. Готовиться к переходу |
| `warning: "context_near_limit"` | Сохранить локальное состояние |
| HTTP 409 `context_exhausted` | Вызвать `/v1/chat/new`, повторить запрос |
| HTTP 503 `server_busy` | Дождаться перезапуска сервера |

Полный протокол: [Управление сессией](session-management.md).
Референсная реализация: `examples/05_session.*`.

---

## Мультиагентное приложение

N агентов = N процессов на N портах. Каждый — со своим состоянием,
ключом, чатом.

### Схема

```
                ┌──HTTP:3000──> Процесс A ──Playwright──> Chromium A ──> Чат A
Клиент ─────────┤
                └──HTTP:3001──> Процесс B ──Playwright──> Chromium B ──> Чат B
```

Запросы к A и B выполняются **параллельно** — это два независимых
браузера. Внутри каждого процесса — сериализация (TaskQueue), между
процессами — реальная параллельность.

### Почему не один процесс

Один процесс мог бы переключаться между чатами (клик в сайдбаре
DeepSeek), но:

- переключение — 3–5 секунд на UI-навигацию;
- `context_status` привязан к одному счётчику, при переключении
  сбивается;
- параллельной работы всё равно нет — TaskQueue один.

Для двух-трёх агентов и последовательного workflow это было бы
терпимо. Для десятка агентов и чередующихся запросов — нет. Два
процесса решают задачу без единой правки кода API.

### Проблема: логин и капча

Прежде чем говорить о схеме, надо понять, **почему** нельзя просто
запустить два процесса с разными `state.json` и дать каждому
залогиниться сам.

DeepSeek Web защищён Cloudflare Turnstile. Автоматизированный
Chromium детектируется по десяткам сигналов: `navigator.webdriver`,
Canvas/WebGL fingerprint, порядок заголовков, TLS JA3, отсутствие
истории куки. Итоговый trust score оказывается ниже порога, и
челлендж повторяется.

**Что видит пользователь:**

- Открывается окно Chromium.
- Появляется форма входа — логин/пароль заполняются автоматически.
- Появляется капча Cloudflare.
- Пользователь решает капчу вручную — правильно.
- Капча появляется снова.
- Пользователь решает снова — правильно.
- И так бесконечно.

Проблема не в правильности ответов. Cloudflare агрегирует сигналы
и решает, что браузер — автоматизированный. Правильные ответы
игнорируются, потому что **сам браузер уже помечен**.

Чем больше попыток, тем хуже: каждая неудачная попытка ухудшает
trust score, и следующая капча становится строже. Это by design,
не bug.

**Второй процесс в такой ситуации только усугубит картину:** два
автоматизированных логина с одного IP → Cloudflare поднимет уровень
защиты для всего аккаунта.

### Решение: один state, много чатов

Мы **убираем логин из критического пути**. Логин происходит один раз,
в обычном браузере (Firefox или Chrome), а автоматизированные
процессы просто используют уже установленную cookie-сессию.

```
                ┌─────────────────────────────┐
                │ shared-state.json           │   ← DeepSeek cookies
                │ (одна cookie-сессия)        │      записаны один раз,
                └──────────────┬──────────────┘      читаются всеми
                               │
                ┌──────────────┴──────────────┐
                │                             │
       ┌────────▼─────────┐         ┌─────────▼────────┐
       │ Процесс A        │         │ Процесс B        │
       │ PORT=3000        │         │ PORT=3001        │
       │ chat_state-a     │         │ chat_state-b     │
       │ .api-key-a       │         │ .api-key-b       │
       │ uploads-a        │         │ uploads-b        │
       │ rag_data-a       │         │ rag_data-b       │
       └──────────────────┘         └──────────────────┘
```

**Что общего:**
- `DEEPSEEK_STATE_PATH` — одна cookie-сессия DeepSeek.

**Что уникально:**
- `DEEPSEEK_CHAT_STATE_PATH` — иначе агенты перезапишут друг другу
  `lastChatId` и оба окажутся в одном чате.
- `DEEPSEEK_API_KEY_PATH` — иначе клиент не различит агентов.
- `DEEPSEEK_UPLOAD_DIR` — иначе файлы смешаются при одновременной
  загрузке.
- `RAG_DATA_DIR` — иначе индексы лягут в одну папку.
- `PORT` — очевидно.

**Почему это работает.** Cloudflare доверяет обычному Firefox сильнее,
чем headless Chromium под Playwright. Один успешный логин из
нормального браузера даёт куки, которые Playwright потом просто
переиспользует. Автоматизированный браузер не проходит челлендж — он
его **вообще не видит**, потому что никогда не заходит на `/sign_in`.

**Это не обход защиты.** Мы не пытаемся обмануть Cloudflare. Мы
разделяем две роли: «получить куки» и «использовать куки». Первая
роль — человеческая, вторая — автоматизированная. Это стандартная
архитектура для браузерной автоматизации.

### Пошаговый рецепт

#### Шаг 1. Создать `.env.a` и `.env.b`

**`.env.a`:**

```ini
PORT=3000

# Общий state — куки DeepSeek
DEEPSEEK_STATE_PATH=./shared-state.json

# Изолированное состояние агента A
DEEPSEEK_CHAT_STATE_PATH=./chat_state-a.json
DEEPSEEK_API_KEY_PATH=./.api-key-a
DEEPSEEK_UPLOAD_DIR=./uploads-a
RAG_DATA_DIR=./rag_data-a

# Recovery-флаги
ENABLE_RESTORE=true
ENABLE_SNAPSHOT=true
ENABLE_RAG=true

# Важно: headless=true. Логина не будет.
DEEPSEEK_HEADLESS=true
```

**`.env.b`** — то же самое, но с суффиксом `b` и `PORT=3001`.

> **Не забудьте убрать `DEEPSEEK_EMAIL` и `DEEPSEEK_PASSWORD`** из
> этих файлов. Они не нужны, потому что логина не будет. Если они
> останутся, и куки по какой-то причине окажутся невалидными, сервер
> попробует авто-логин и снова попадёт в капчу.

#### Шаг 2. Получить рабочий `state.json`

Здесь два пути. **Путь B (перенос куки) предпочтительнее** — он
полностью устраняет капчу.

##### Путь A: ручной логин через Playwright

```bash
DEEPSEEK_STATE_PATH=/tmp/fresh-state.json \
DEEPSEEK_CHAT_STATE_PATH=/tmp/fresh-chat.json \
DEEPSEEK_API_KEY_PATH=/tmp/fresh-key \
DEEPSEEK_HEADLESS=false \
npm start
```

Откроется Chromium. Если капчи нет — логин пройдёт автоматически,
`/tmp/fresh-state.json` заполнится куками. Если капча появилась —
решите её вручную. Если она уйдёт в бесконечный цикл — переходите
к разделу «Капча: эскалационная лестница» ниже.

**Плюсы:** просто, работает «из коробки», когда везёт.
**Минусы:** капча может убить всё.

##### Путь B: перенос куки из обычного браузера (рекомендуется)

**Это самый надёжный путь.** Автоматизированный браузер никогда не
заходит на `/sign_in`.

**1. Логин в обычном браузере.**

Откройте Firefox (рекомендую именно его — Chrome тоже может быть уже
«примечен» Cloudflare). Зайдите на `chat.deepseek.com`. Введите
логин/пароль. Пройдите капчу, если появится — в обычном браузере она
проходит без проблем.

**2. Экспорт куки.**

Установите расширение **Cookie-Editor** (есть для Firefox и Chrome).
На странице `chat.deepseek.com`:

- Откройте Cookie-Editor.
- Нажмите «Export» → «JSON».
- Скопируйте JSON в буфер обмена.
- Сохраните его в `/tmp/cookies.json`.

Формат Cookie-Editor:

```json
[
  {
    "name": "ds_session_id",
    "value": "eyJ...",
    "domain": ".deepseek.com",
    "path": "/",
    "expirationDate": 1812345678,
    "httpOnly": true,
    "secure": true,
    "sameSite": "Lax"
  }
]
```

**3. Конвертация в Playwright storageState.**

Наш `state.json` — это формат Playwright:

```json
{
  "cookies": [ ... ],
  "origins": []
}
```

Конвертация одной командой `jq`:

```bash
jq '{
  cookies: map({
    name: .name,
    value: .value,
    domain: .domain,
    path: .path,
    expires: (.expirationDate // -1),
    httpOnly: .httpOnly,
    secure: .secure,
    sameSite: (.sameSite // "Lax")
  }),
  origins: []
}' /tmp/cookies.json > shared-state.json

chmod 600 shared-state.json
```

**4. Проверка.**

```bash
jq '.cookies | length' shared-state.json
jq '.cookies[].name' shared-state.json
```

Должно быть **больше 3** куки. В обычном браузере DeepSeek выставляет
больше маркеров, чем headless Playwright. Обычно видны:

- `ds_session_id` — главная сессионная кука.
- `smidV2` — маркер устройства.
- `__cf_bm` — Cloudflare bot management.
- `cf_clearance` — pass Cloudflare challenge (важно!).

Наличие `cf_clearance` критично: он означает, что браузер уже прошёл
челлендж и Cloudflare готов ему доверять. Именно этого не бывает
в headless Playwright.

**5. Первый запуск.**

```bash
# Только процесс A
set -a; source .env.a; set +a
npm start
```

**Ожидаемый лог:**

```
💾 State file: /path/to/shared-state.json
🔧 Validating environment...
📂 Found existing session files. Attempting to restore...
✅ Critical selectors OK
✅ Already logged in
💾 State saved (5 cookies, mtime ...)      ← больше 3!
✅ Chat page loaded
🆕 startFresh: new chat session
✅ DeepSeek client ready!
✅ Session restored. API key: deepseek_...
```

**Чего быть не должно:**
- `📌 On login page, attempting auto-login...` — куки не подхватились.
- `🔐 Performing auto-login...` — сервер лезет в логин.
- `❌ Validation error` — ошибка селектора или сети.

**6. Запуск второго процесса.**

```bash
# Terminal 2
set -a; source .env.b; set +a
npm start
```

**Ожидаемый лог:**

```
💾 State file: /path/to/shared-state.json
🔧 Validating environment...
📂 Found existing session files. Attempting to restore...
✅ Critical selectors OK
💾 Skipping state write (mtime ... > ...)     ← mtime-guard сработал
✅ Already logged in
💾 Skipping state write: file is newer         ← и второй раз
✅ Chat page loaded
🆕 startFresh: new chat session
✅ DeepSeek client ready!
✅ Session restored. API key: deepseek_...
```

Строка `💾 Skipping state write` — **это нормально**, не ошибка. Один
процесс написал свежие куки, второй корректно отступил, чтобы не
затереть их устаревшим слепком. Алгоритм [A6](../algorithms/session.md#a6)
описывает эту семантику подробно.

**7. Проверка изоляции.**

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health

# Ключи не пересекаются
curl http://localhost:3000/v1/context/status -H "Authorization: Bearer $(cat .api-key-a)"
curl http://localhost:3000/v1/context/status -H "Authorization: Bearer $(cat .api-key-b)"
# Второй должен вернуть {"error":"Invalid API key"}

# Чаты разные
jq '.deepseek.lastChatId' chat_state-a.json
jq '.deepseek.lastChatId' chat_state-b.json
# Значения должны отличаться
```

**8. Функциональный тест.**

```bash
# Запрос к A
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $(cat .api-key-a)" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say exactly: agent A is alive."}]}'

# Запрос к B
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $(cat .api-key-b)" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say exactly: agent B is alive."}]}'
```

Оба должны вернуть ответ с `"finish_reason":"stop"` и заполненным
`context_status`.

**9. Ежедневная работа.**

- Оба процесса работают headless, без логина.
- Клиент отправляет запросы на соответствующие порты со своими ключами.
- Сервер сам управляет контекстом, снапшотами, RAG — на уровне
  каждого процесса.
- Клиент не знает о существовании «общего state» — для него это два
  независимых API.

### Капча: эскалационная лестница

Если капча всё-таки появилась и ушла в бесконечный цикл — действуйте
по шагам, **сверху вниз**. Останавливайтесь на первом, который
сработал.

#### Уровень 1. Перенос куки из обычного браузера

Это должно быть **первым шагом**, а не последним. См. «Путь B» выше.
Никакого логина в автоматизированном браузере — просто перенос уже
установленных куки.

#### Уровень 2. Ручной логин в headless=false

Если перенос невозможен (нет доступа к обычному браузеру на этой
машине):

```bash
DEEPSEEK_STATE_PATH=/tmp/fresh.json \
DEEPSEEK_HEADLESS=false \
npm start
```

Откроется Chromium. Решите капчу руками. Если проходит за 2–3
попытки — победа.

#### Уровень 3. Свежий Chromium

Если текущий Chromium уже «сожжён» Cloudflare:

```bash
# Сохраните рабочий state, если он есть
cp state.json state.json.backup

# Удалите браузер
rm -rf browsers/

# Переустановите
mkdir -p browsers
PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium

# Попробуйте логин с ЧИСТЫМ state
rm -f state.json
DEEPSEEK_HEADLESS=false npm start
```

Новая установка Chromium = новый fingerprint. Иногда этого достаточно:
Cloudflare видит «новое устройство» и снижает уровень паранойи.

#### Уровень 4. Смена IP

Cloudflare может блокировать не только браузер, но и IP. Переключитесь
на:

- **Мобильный хотспот** (с телефона). Это самый быстрый и надёжный
  вариант — мобильные операторы обычно имеют «чистые» диапазоны IP
  с точки зрения Cloudflare.
- **VPN** — работает хуже, потому что IP многих VPN уже «примечены».
- **Другую машину в той же сети** — не поможет, IP тот же.

После смены IP повторите Уровень 2.

#### Уровень 5. Удаление и перерегистрация аккаунта

**Только если всё остальное не работает.**

Насколько это помогает — зависит от причины. Если проблема в
**браузере** или **IP**, удаление аккаунта не поможет: новый аккаунт
с того же браузера и IP столкнётся с теми же проверками. Если
проблема в **аккаунте** (Cloudflare пометил конкретно ваш аккаунт) —
поможет.

**Процесс:**

1. Откройте `chat.deepseek.com` в **обычном** браузере (Firefox).
2. Войдите (если получится — значит проблема была в automated browser).
3. Откройте **Settings → Profile**.
4. Прокрутите вниз — там будет **Delete account**.
5. Удалите аккаунт. Подтверждение обычно через email-код.
6. Дождитесь полного удаления (иногда час-два).
7. Зарегистрируйте **новый аккаунт** с **другого email**.
8. **Первый логин** сделайте с той машины, где будет работать
   автоматизация, чтобы fingerprint был «связан» с новым аккаунтом.

> **Важное замечание.** Cloudflare запоминает fingerprint устройств
> на 30–90 дней. Если ваш текущий Chromium уже был помечен как
> «automated», даже новый аккаунт может ловить капчу. В этом случае
> помогает комбинация Уровня 3 + Уровня 4 + Уровня 5.

### Почему перенос куки — реальное решение, а не костыль

Многие думают: «cookie transfer — это хак, надо нормально логиниться».
На практике это **архитектурно правильный путь** для автоматизации:

- **Один логин = одна сессия = одни куки.** Мы просто делаем логин на
  «правильном» устройстве.
- **Cloudflare не отличает** валидные куки, перенесённые из Firefox,
  от куки, полученных самим Playwright. Ему важен cookie-токен, а не
  то, как он к вам попал.
- **Не нужно эмулировать браузер** — вы и есть нормальный браузер на
  этапе логина.

Единственный минус: при экспирации куки нужно повторить экспорт.
Это раз в 1–3 месяца, не критично.

### Чего не делать

- **Не пытайтесь решать капчу в цикле.** Правильные ответы,
  отправленные с «низким trust score», будут отклоняться. Вы потратите
  часы.
- **Не используйте сторонние captcha-сервисы** (2captcha, CapSolver).
  Cloudflare Turnstile сложнее, чем hCaptcha/reCAPTCHA. Даже если
  сервис справится с челленджем, итоговый trust score останется
  низким, и логин упадёт на следующем шаге.
- **Не отключайте защиту через `--disable-blink-features`** — это
  работает для старых детекторов, но Turnstile смотрит на десятки
  других сигналов.

### Что делать, когда куки истекают

Куки DeepSeek живут **1–3 месяца** (в зависимости от активности
аккаунта). Когда они истекают:

**Симптомы:**
- `⚠️ restorePrevious failed`, `startFresh` тоже не помогает.
- `📌 On login page, attempting auto-login...` — не должно происходить
  при shared-state.
- `❌ Chat page did not load (mainTextarea not visible)`.
- HTTP 401 от DeepSeek.

**Действия:**
1. Остановите оба процесса (`npx kill-port 3000 3001`).
2. Обновите `shared-state.json` через Путь B (перенос куки).
3. Запустите оба процесса заново.
4. Убедитесь, что оба видят `✅ Already logged in`.

История чатов и RAG-индексы не пострадают. Меняется только браузерная
сессия.

### Полный пример: два `.env`

**`.env.a`:**

```ini
PORT=3000
DEEPSEEK_STATE_PATH=./shared-state.json
DEEPSEEK_CHAT_STATE_PATH=./chat_state-a.json
DEEPSEEK_API_KEY_PATH=./.api-key-a
DEEPSEEK_UPLOAD_DIR=./uploads-a
RAG_DATA_DIR=./rag_data-a
DEEPSEEK_HEADLESS=true
ENABLE_RESTORE=true
ENABLE_SNAPSHOT=true
ENABLE_RAG=true
```

**`.env.b`:**

```ini
PORT=3001
DEEPSEEK_STATE_PATH=./shared-state.json
DEEPSEEK_CHAT_STATE_PATH=./chat_state-b.json
DEEPSEEK_API_KEY_PATH=./.api-key-b
DEEPSEEK_UPLOAD_DIR=./uploads-b
RAG_DATA_DIR=./rag_data-b
DEEPSEEK_HEADLESS=true
ENABLE_RESTORE=true
ENABLE_SNAPSHOT=true
ENABLE_RAG=true
```

Запуск:

```bash
# Terminal 1
set -a; source .env.a; set +a
npm start

# Terminal 2 (через 10–15 секунд)
set -a; source .env.b; set +a
npm start
```

Оба пишут в один `shared-state.json`. Первый сохранит куки, второй
напечатает `💾 Skipping state write` и продолжит. Оба работают
параллельно, каждый со своим чатом.

---

## Обработка ошибок в мультиагентной системе

Каждый агент возвращает стандартные коды. Логика клиента зависит от
кода:

| Код | Что значит | Что делать |
|---|---|---|
| `200` | Успех | Продолжать |
| `400` | Ошибка валидации запроса | Исправить запрос, не retry |
| `401` | Ключ не совпадает с файлом | Проверить `.api-key-*` |
| `409` | Контекст переполнен | `/v1/chat/new {restore:false}`, повторить |
| `503` | Server Busy, сервер уходит в shutdown | Ждать перезапуска, не retry |
| `504` | Таймаут | Retry с экспоненциальным backoff |

**Про 503 в мультиагентной системе.** Один процесс может уйти в
shutdown, второй продолжит работать. Клиент должен различать, какой
именно агент недоступен, и маршрутизировать остальные запросы в
живые процессы. Общий оркестратор не должен падать целиком.

**Про перезапуск после 503.** Внешний супервизор (systemd, pm2,
Docker restart policy) поднимает упавший процесс. Клиент не
перезапускает сервер сам — он только ждёт.

---

## Клиентская оркестрация

Клиент думает **об агентах**, не о чатах. Чаты — забота сервера.

```python
import requests
from pathlib import Path

SERVERS = {
    "researcher": ("http://localhost:3000", Path(".api-key-a")),
    "writer":     ("http://localhost:3001", Path(".api-key-b")),
}

def ask(agent, content, retries=3):
    url, key_path = SERVERS[agent]
    key = key_path.read_text().strip()

    for i in range(retries):
        r = requests.post(
            f"{url}/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"messages": [{"role": "user", "content": content}]},
            timeout=300,
        )
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"]
        if r.status_code == 409:
            # Контекст переполнен — начать новый чат и повторить
            requests.post(
                f"{url}/v1/chat/new",
                headers={"Authorization": f"Bearer {key}"},
                json={"restore": False},
                timeout=120,
            )
            continue
        if r.status_code == 504:
            import time
            time.sleep(2 ** i)
            continue
        r.raise_for_status()
    raise RuntimeError(f"{agent} gave up after {retries} attempts")

def pipeline(topic):
    facts = ask("researcher", f"Find three facts about {topic}.")
    draft = ask("writer", f"Write an intro based on: {facts}")
    review = ask("researcher", f"Critique this: {draft}")
    return ask("writer", f"Revise based on critique: {review}")
```

Каждый `ask` идёт на свой порт со своим ключом. Серверы работают
независимо. Клиент не знает про чаты, `totalChars`, снапшоты — всё
это делает сервер.

---

## Управление процессами — кроссплатформенно

Команды вроде `pkill` или `lsof` работают не на всех платформах.
Универсальный вариант:

```bash
npx kill-port 3000 3001
```

Работает на Linux, macOS и Windows. Убивает процессы, слушающие
указанные порты.

### Остановка по PID-файлу

**Linux / macOS / Git Bash:**

```bash
kill $(cat server-a.pid)
kill $(cat server-b.pid)
```

**PowerShell:**

```powershell
Stop-Process -Id (Get-Content server-a.pid)
Stop-Process -Id (Get-Content server-b.pid)
```

**cmd:**

```cmd
for /f %i in (server-a.pid) do taskkill /PID %i /F
for /f %i in (server-b.pid) do taskkill /PID %i /F
```

### Полная очистка

```bash
# Остановить оба процесса
npx kill-port 3000 3001

# Удалить состояние
rm -rf state-a.json chat_state-a.json .api-key-a uploads-a rag_data-a
rm -rf state-b.json chat_state-b.json .api-key-b uploads-b rag_data-b
rm -f shared-state.json
rm -f server-a.pid server-b.pid server-a.log server-b.log
```

При следующем запуске процесс нужно будет заново прогнать через
перенос куки (Путь B).

---

## Перезапуск с восстановлением

После остановки и повторного запуска `ENABLE_RESTORE=true`
восстанавливает чат каждого процесса из его `chat_state-*.json`:

1. Читается `lastChatId`.
2. Открывается соответствующий чат в DeepSeek.
3. Восстанавливаются `totalChars`, флаги снапшота, `ragSearchActive`.

См. [A2](../algorithms/session.md#a2) и
[A6](../algorithms/session.md#a6).

Клиенту **не нужно ничего менять** — URL те же, ключи те же, чаты
те же. Единственное, что замечает пользователь: первый запрос после
перезапуска идёт чуть дольше (идёт восстановление).

---

## Сколько агентов можно запустить

| Ресурс | Ограничение |
|---|---|
| **Память** | ~500 МБ на процесс (Chromium + Node + эмбеддинги) |
| **CPU** | Каждый Chromium активен во время запроса |
| **DeepSeek rate limit** | Один аккаунт, один IP — все процессы делят лимит |
| **Логины** | Только один логин при shared-state |
| **Порты** | Один порт на процесс |

Практически: **2–5 агентов на одной машине** работают комфортно.
Дальше начинает упираться в память и rate limit DeepSeek.

Если нужно больше агентов — варианты:

- **Несколько аккаунтов DeepSeek.** Каждый процесс со своим
  `DEEPSEEK_STATE_PATH`. Снимает ограничение rate limit, но требует
  регистрации дополнительных аккаунтов и переноса куки для каждого.
- **Очередь поверх N процессов.** Клиент сам решает, какой агент
  сейчас работает, остальные ждут. Меньше параллельности, но
  предсказуемо по нагрузке.
- **Горизонтальное масштабирование.** N машин, по M процессов на
  каждой. Сложнее в эксплуатации.

---

## Что нужно помнить

1. **Один процесс = одна сессия.** Мультиагентность — через
   несколько процессов, не через один.
2. **Shared state — куки, не чаты.** `DEEPSEEK_STATE_PATH` общий,
   всё остальное — уникальное.
3. **Логин один раз, через обычный браузер.** Куки переносятся
   через Cookie-Editor и одну команду `jq`.
4. **Не воюйте с капчей.** Если она появилась в автоматизированном
   браузере — переходите на Путь B (перенос куки). Это не костыль,
   а архитектура.
5. **Куки живут 1–3 месяца.** При экспирации — повторить Путь B.
6. **Клиент думает об агентах.** Чаты, снапшоты, переходы — забота
   сервера.
7. **Кроссплатформенно.** `npx kill-port` вместо `pkill`. PowerShell
   вместо `kill $(cat ...)` на Windows.

---

## Связанные разделы

- [Установка](installation.md) — переменные окружения, пути.
- [Использование](usage.md) — HTTP-эндпоинты, примеры запросов.
- [Управление сессией](session-management.md) — два лимита,
  деградация, обработка ошибок.
- [Тестирование](testing.md) — наборы тестов и команды.
- [Диагностика](troubleshooting.md) — частые проблемы, включая
  `Skipping state write`.
- [A1 — Client initialization](../algorithms/session.md#a1) —
  сериализация стартовых шагов.
- [A6 — State persistence](../algorithms/session.md#a6) —
  mtime-guard и атомарная запись.
