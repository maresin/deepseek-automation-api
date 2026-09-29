# Построение приложений на API

Практическое руководство для тех, кто использует DeepSeek Automation API
как backend для своего приложения — от простого чат-клиента до
мультиагентной системы.

Документ отвечает на три вопроса:

- Как устроена сессия и что клиент может с ней делать.
- Как построить одноагентное приложение.
- Как построить мультиагентное приложение на нескольких процессах.

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
ключом, чатом. Клиент маршрутизирует запросы между портами.

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

### Подготовка: два `.env`

Создайте `.env.a` и `.env.b` в корне проекта.

**`.env.a`:**

```ini
PORT=3000
DEEPSEEK_EMAIL=your@email.com
DEEPSEEK_PASSWORD=your_password
DEEPSEEK_HEADLESS=true

DEEPSEEK_STATE_PATH=./state-a.json
DEEPSEEK_CHAT_STATE_PATH=./chat_state-a.json
DEEPSEEK_API_KEY_PATH=./.api-key-a
DEEPSEEK_UPLOAD_DIR=./uploads-a
RAG_DATA_DIR=./rag_data-a

ENABLE_RESTORE=true
ENABLE_SNAPSHOT=true
ENABLE_RAG=true
```

**`.env.b`** — те же значения с суффиксом `b` и другим портом:

```ini
PORT=3001
DEEPSEEK_EMAIL=your@email.com
DEEPSEEK_PASSWORD=your_password
DEEPSEEK_HEADLESS=true

DEEPSEEK_STATE_PATH=./state-b.json
DEEPSEEK_CHAT_STATE_PATH=./chat_state-b.json
DEEPSEEK_API_KEY_PATH=./.api-key-b
DEEPSEEK_UPLOAD_DIR=./uploads-b
RAG_DATA_DIR=./rag_data-b

ENABLE_RESTORE=true
ENABLE_SNAPSHOT=true
ENABLE_RAG=true
```

> **Ключевое.** `DEEPSEEK_EMAIL` и `DEEPSEEK_PASSWORD` **общие** — это
> один аккаунт DeepSeek. Всё остальное — пути и порты — **разные**.

Все шесть переменных, изолирующих состояние процесса, описаны в
[Установке](installation.md#paths). Если хотя бы одна останется
общей — процессы будут конфликтовать.

### Первый запуск — вручную, по одному

При первом запуске каждый процесс проходит логин в DeepSeek и
создаёт свои файлы состояния. **Не запускайте одновременно** — два
параллельных логина в один аккаунт могут вызвать captcha или
rate limit.

```bash
# Терминал 1
set -a; source .env.a; set +a
npm start
# Дождаться "🚀 DeepSeek API server running on http://localhost:3000"
# Ctrl+C

# Пауза 10–20 секунд

# Терминал 2
set -a; source .env.b; set +a
npm start
# Дождаться "🚀 DeepSeek API server running on http://localhost:3001"
# Ctrl+C
```

После этого в корне появятся:

```
state-a.json        state-b.json
chat_state-a.json   chat_state-b.json
.api-key-a          .api-key-b
uploads-a/          uploads-b/
rag_data-a/         rag_data-b/
```

### Рабочий запуск

**Linux / macOS / Git Bash:**

```bash
# Терминал 1
set -a; source .env.a; set +a
npm start
```

```bash
# Терминал 2
set -a; source .env.b; set +a
npm start
```

**PowerShell:**

```powershell
# Терминал 1
Get-Content .env.a | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
    }
}
npm start
```

**Вариант для продакшена — с логами и PID-файлами:**

```bash
set -a; source .env.a; set +a
nohup npm start > server-a.log 2>&1 &
echo $! > server-a.pid
sleep 20

set -a; source .env.b; set +a
nohup npm start > server-b.log 2>&1 &
echo $! > server-b.pid
```

Пауза 20 секунд обязательна — второй логин должен произойти
**после** того, как первый завершился.

### Проверка

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
```

Оба должны вернуть `{"status":"ok",...}`.

### Ключи для клиента

Каждый процесс пишет свой ключ:

```bash
KEY_A=$(cat .api-key-a)
KEY_B=$(cat .api-key-b)
```

Клиент хранит их в конфиге:

```python
SERVERS = {
    "researcher": {
        "url": "http://localhost:3000",
        "key_path": ".api-key-a",
    },
    "writer": {
        "url": "http://localhost:3001",
        "key_path": ".api-key-b",
    },
}
```

Ключи не меняются между перезапусками, пока файлы `.api-key-*` на
месте.

### Клиентская оркестрация

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

## Управление процессами — кроссплатформенно

Команды из документации вроде `pkill` или `lsof` работают не на всех
платформах. Универсальный вариант:

```bash
npx kill-port 3000 3001
```

Работает на Linux, macOS и Windows одинаково. Убивает процессы,
слушающие указанные порты.

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

Если нужно начать с чистого листа:

```bash
# Остановить оба процесса
npx kill-port 3000 3001

# Удалить состояние
rm -rf state-a.json chat_state-a.json .api-key-a uploads-a rag_data-a
rm -rf state-b.json chat_state-b.json .api-key-b uploads-b rag_data-b
rm -f server-a.pid server-b.pid server-a.log server-b.log
```

При следующем запуске оба процесса зарегистрируются заново.

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

Ограничения, которые нужно учитывать при масштабировании.

| Ресурс | Ограничение |
|---|---|
| **Память** | ~500 МБ на процесс (Chromium + Node + эмбеддинги) |
| **CPU** | Каждый Chromium активен во время запроса |
| **DeepSeek rate limit** | Один аккаунт, один IP — все процессы делят лимит |
| **Логины** | N процессов = N логинов в один аккаунт при старте |
| **Порты** | Один порт на процесс |

Практически: **2–5 агентов на одной машине** работают комфортно.
Дальше начинает упираться в память и rate limit DeepSeek.

Если нужно больше агентов — варианты:

- **Несколько аккаунтов DeepSeek.** Каждый процесс со своим
  `DEEPSEEK_EMAIL`. Снимает ограничение rate limit, но требует
  регистрации дополнительных аккаунтов.
- **Очередь поверх N процессов.** Клиент сам решает, какой агент
  сейчас работает, остальные ждут. Меньше параллельности, но
  предсказуемо по нагрузке.
- **Горизонтальное масштабирование.** N машин, по M процессов на
  каждой. Сложнее в эксплуатации.

---

## Что нужно помнить

1. **Один процесс = одна сессия.** Мультиагентность — через
   несколько процессов, не через один.
2. **Изоляция через env-переменные.** Шесть путей и один порт.
   Общие только `DEEPSEEK_EMAIL` / `DEEPSEEK_PASSWORD`.
3. **Запуск последовательный.** Пауза 10–20 секунд между логинами.
4. **Ключи в файлах.** `.api-key-a` / `.api-key-b`. Клиент читает оба.
5. **Клиент думает об агентах.** Чаты, снапшоты, переходы — забота
   сервера.
6. **Кроссплатформенно.** `npx kill-port` вместо `pkill`. PowerShell
   вместо `kill $(cat ...)` на Windows.
7. **Перезапуск бесплатный.** `ENABLE_RESTORE=true` возвращает чаты
   без правок в клиенте.

---

## Связанные разделы

- [Установка](installation.md) — переменные окружения, пути.
- [Использование](usage.md) — HTTP-эндпоинты, примеры запросов.
- [Управление сессией](session-management.md) — два лимита,
  деградация, обработка ошибок.
- [Тестирование](testing.md) — наборы тестов и команды.
- [Алгоритмы](../algorithms/index.md) — контрактные описания
  процессов.