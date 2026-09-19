# Архитектура: поток данных

Один запрос проходит пять слоёв. Ниже — что происходит на каждом шаге.

## Путь запроса POST /v1/chat/completions

```
1. HTTP → Express
   ├── globalLimiter (100 req/min)
   ├── chatLimiter (30 req/min)
   └── authenticate (Bearer token)

2. chat.js → handleChatRoute
   ├── validateMessages / validateTools / validateExtraBody
   ├── client.checkDeepSeekAvailable()
   └── global.currentApiKey := apiKey

3. RAG init (если ENABLE_RAG)
   └── store := getHistoryStore(apiKey)

4. Резолв file_id → tempFilePaths
   ├── extractFileIdsFromMessages
   ├── extractTextFromMessages
   └── resolveFileId (через files.js)

5. Multipart files (если есть)
   ├── validate ext / size / non-empty
   └── move to uploads/

6. buildPrompt(fullMessages, tools)

7. RAG search (если ragSearchActive)
   ├── store.search(userText, currentChatId, 5)
   ├── grouped by exchange / file
   ├── write uploads/rag_context_<ts>.txt
   ├── prepend System-message с инструкцией
   └── rebuild prompt

8. TaskQueue.add
   ├── SwitchDeepThinkTask
   ├── SwitchWebSearchTask
   └── SendUserMessageTask

9. SendUserMessageTask.execute
   ├── analyzeUserMessage (язык)
   ├── если needTransition: handleOverflow()
   ├── ensureToolsPrompt / ensureMultiRolePrompt
   ├── fileUploader.upload(tempFilePaths)
   ├── executePipeline(text)
   │   ├── getMaxMessageKey()
   │   ├── attachFile (если filePath)
   │   ├── clearInput + typeMessage + send
   │   ├── detectBanner (early warning)
   │   ├── waitForFullResponse(lastKey)
   │   │   ├── waitForChunkComplete (фазы A/B)
   │   │   ├── scrollToBottomIfNeeded
   │   │   ├── hasContinueButton → click → continue
   │   │   └── getCopyTextByKeyWithRegenerate
   │   ├── detectServerBusy (если ответ пуст)
   │   └── contextManager.addChars(text + response)
   └── client.currentChatId := getCurrentChatId()
       setChatStarted(true)
       saveChatState()

10. RAG save exchange (если useSearchRAG)

11. IndexingQueue.enqueue (файлы; гейт — client.currentChatId)

12. Cleanup (не-enqueued файлы)

13. HTTP response (OpenAI format + context_status)
```

> **О RAG-индексации первого файла.** Шаг 11 гейтится на
> `client.currentChatId`, который уже установлен в конце
> `SendUserMessageTask.execute()` (шаг 9). Никакого переприсвоения
> `null`-chatId не требуется — файлы всегда индексируются с реальным ID.
> Механизм R5 (`reassignNullChatId`) существует как reserved-страховка
> на случай изменения гейта, но не вызывается.

## Путь запроса POST /v1/chat/new

```
1. authenticate
2. client.newChat({ restore })
   ├── restore === true  → restorePrevious()
   │   ├── loadChatState() → lastChatId
   │   ├── chatExists(lastChatId)? нет → clearPersistentState, throw
   │   ├── restoreChatById(lastChatId)
   │   └── восстановить totalChars, флаги снапшота, ragSearchActive
   └── restore === false → startFresh()
       ├── clearPersistentState()
       ├── chatController.newChat()
       ├── getCurrentChatId()
       ├── clearSnapshot()
       └── clearRagIndexIfEnabled()
3. HTTP 200 / 409 (restore_failed)
```

## Путь фоновой индексации

```
IndexingQueue.enqueue(job)
  └── process()  // async, не блокирует HTTP

runJob(job):
  ├── skip service files (snapshot*, rag_context*)
  ├── isIndexableFile?
  ├── readTextFileSafe
  ├── getHistoryStore(apiKey)
  ├── chunkText(content, RAG_CHUNK_SIZE)
  ├── для каждого чанка: store.addFileChunk(...)
  └── store.flushIndex()
```

## Потоки состояния

| Что | Куда | Когда |
|---|---|---|
| `state.json` | диск | После `initialize`, `validateEnvironment`, ручного логина |
| `chat_state.json` | диск | После каждого `addChars`, смены chatId, перехода |
| `snapshot.txt` | диск | 70% / 90% пороги |
| `rag_data/<key>.linear.json` | диск | После `addExchange`, `flushIndex`, `clear` |
| `uploads/*` | диск | Multipart uploads, RAG context, snapshot |

## Что блокирует запрос

- **Browser automation** (15–30 сек): send + wait for response.
- **Embedding загрузка** (2–3 сек, только первый запрос): init RAG.
- **RAG search** (<100 мс): линейный скан.
- **Файловая индексация** (минуты для больших файлов): **не блокирует**,
  уходит в фон.

## Что возвращается клиенту

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [{ "message": { "role": "assistant", "content": "..." } }],
  "usage": { "prompt_tokens": ..., "completion_tokens": ..., "total_tokens": ... },
  "context_status": {
    "chars_used": ...,
    "chars_limit": ...,
    "percent_used": ...,
    "language_mix": { "latin": ..., "cyrillic": ..., "cjk": ..., "other": ... },
    "language_coefficient": ...,
    "deepseek_length_limit": { "detected": false, "readable_percent": null },
    "warning": null,
    "recommendation": null
  }
}
```

`context_status` — расширение вне OpenAI-схемы. Клиент может его
игнорировать или использовать для мониторинга.

См. [Слои](layers.md) и [Обзор](overview.md).