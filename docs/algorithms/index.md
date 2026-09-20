# Каталог алгоритмов

Все алгоритмы, определяющие поведение API, зафиксированы ниже.
**Алгоритм — это контракт.** Изменения возможны только через замену:
старая версия помечается `deprecated`, новая описывается как отдельный
пункт с указанием причины.

## Как читать

Каждый алгоритм имеет три поля состояния:

| Поле | Значение |
|------|----------|
| **Статус** | `active` — действует; `reserved` — определён, но не вызывается; `deprecated` — заменён; `planned` — в разработке |
| **Версия** | Порядковый номер версии алгоритма |
| **Дата фиксации** | Дата, когда версия была зафиксирована |

## Полный список

### Управление сессией

| # | Алгоритм | Статус | Файл |
|---|----------|--------|------|
| A1 | Инициализация клиента | active | [session.md](session.md#a1) |
| A2 | Восстановление предыдущей сессии | active | [session.md](session.md#a2) |
| A3 | Начало новой сессии | active | [session.md](session.md#a3) |
| A4 | Авто-переход при переполнении | active | [session.md](session.md#a4) |
| A5 | Восстановление чата по ID | active | [session.md](session.md#a5) |
| A6 | Хранение и загрузка состояния | active | [session.md](session.md#a6) |

### Отправка сообщения и ожидание ответа

| # | Алгоритм | Статус | Файл |
|---|----------|--------|------|
| B1 | Построение промпта из messages | active | [response.md](response.md#b1) |
| B2 | Ожидание завершения ответа (Stop/Continue) | active | [response.md](response.md#b2) |
| B3 | Извлечение ответа через Copy | active | [response.md](response.md#b3) |
| B4 | Fallback через markdown | active | [response.md](response.md#b4) |
| B5 | Детект баннера длины | active | [response.md](response.md#b5) |
| B6 | Детект плашки Server Busy | active | [response.md](response.md#b6) |
| B7 | Обработка Server Busy → shutdown | active | [response.md](response.md#b7) |
| B8 | Извлечение tool_calls из ответа модели | active | [response.md](response.md#b8) |

### Управление контекстом

| # | Алгоритм | Статус | Файл |
|---|----------|--------|------|
| C1 | Анализ языка и языковой коэффициент | active | [context.md](context.md#c1) |
| C2 | Динамический лимит контекста | active | [context.md](context.md#c2) |
| C3 | Пороговые срабатывания (70% / 90%) | active | [context.md](context.md#c3) |
| C4 | Создание снапшота | active | [context.md](context.md#c4) |
| C5 | Перезапись снапшота на 90% | active | [context.md](context.md#c5) |
| C6 | Очистка снапшота после перехода | active | [context.md](context.md#c6) |
| C7 | Оценка размера запроса (`totalChars`) | active | [context.md](context.md#c7) |

### RAG

| # | Алгоритм | Статус | Файл |
|---|----------|--------|------|
| R1 | Чанкование текста | active | [rag.md](rag.md#r1) |
| R2 | Эмбеддинг и хранение | active | [rag.md](rag.md#r2) |
| R3 | Поиск с фильтром по chatId | active | [rag.md](rag.md#r3) |
| R4 | Ранжирование (semantic + recency) | active | [rag.md](rag.md#r4) |
| R5 | Механизм переприсвоения chatId | reserved | [rag.md](rag.md#r5) |
| R6 | Фоновая индексация файлов | active | [rag.md](rag.md#r6) |
| R7 | Очистка индекса при fresh start | active | [rag.md](rag.md#r7) |
| R8 | Инъекция RAG-контекста как файла | active | [rag.md](rag.md#r8) |

### Обработка файлов

| # | Алгоритм | Статус | Файл |
|---|----------|--------|------|
| F1 | Классификация по расширению | active | [files.md](files.md#f1) |
| F2 | Оценка размера (текст / изображение) | active | [files.md](files.md#f2) |
| F3 | Загрузка файла в UI | active | [files.md](files.md#f3) |
| F4 | Ретрай при «Server busy» в плашке | active | [files.md](files.md#f4) |

### Очереди и синхронизация

| # | Алгоритм | Статус | Файл |
|---|----------|--------|------|
| Q1 | Сериализация UI-задач | active | [queues.md](queues.md#q1) |
| Q2 | Приоритеты high / normal | active | [queues.md](queues.md#q2) |
| Q3 | Ретраи задач | active | [queues.md](queues.md#q3) |
| Q4 | Фоновые CPU-задачи (индексация) | active | [queues.md](queues.md#q4) |
| Q5 | Корректное завершение фоновых задач | active | [queues.md](queues.md#q5) |

### Обработка ошибок

| # | Алгоритм | Статус | Файл |
|---|----------|--------|------|
| E1 | `ContextExhaustedError` | active | [errors.md](errors.md#e1) |
| E2 | `ServerBusyError` | active | [errors.md](errors.md#e2) |
| E3 | Валидация запросов | active | [errors.md](errors.md#e3) |
| E4 | Трансляция ошибок в HTTP | active | [errors.md](errors.md#e4) |

---

## Правила работы с каталогом

1. **Алгоритм фиксируется один раз.** После фиксации он не редактируется.
2. **Замена — через добавление.** Старый помечается `deprecated`,
   новый пишется как отдельная версия.
3. **Причина замены обязательна.** В новом алгоритме указывается, какую
   проблему старого он решает.
4. **Реализация может отставать.** Алгоритм описывает контракт,
   файлы могут быть не готовы. Это допустимо, если зафиксировано в поле
   «История».
5. **Reserved ≠ deprecated.** `reserved` означает «определён, но не
   вызывается». `deprecated` — «заменён, больше не используется».
   R5 — пример reserved.
6. **Селекторы не являются алгоритмами.** Они живут в разделе
   [Селекторы](../selectors/catalog.md) и могут меняться свободно —
   при поломке UI обновляются без процедуры замены.