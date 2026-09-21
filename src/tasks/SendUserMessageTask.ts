// src/tasks/SendUserMessageTask.ts
/**
 * @file src/tasks/SendUserMessageTask.ts
 * Task for sending a user message with optional file attachments.
 * Handles context transitions, RAG search, and session state persistence.
 *
 * RAG indexing of attached files is not done here — the files are
 * uploaded to the DeepSeek UI for the current message, and chat.js
 * enqueues them into the background IndexingQueue once the chatId is
 * known. This keeps the request-response cycle short even for large
 * files, whose embedding can take minutes.
 *
 * Both session-level prompts (tools, multi-role) are loaded from
 * prompts/ on first use and sent once per session. See the
 * prompts/ directory for the actual text.
 */

import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';
import { ContextExhaustedError } from '../types.js';
import { loadPrompt } from '../utils/prompts.js';

export class SendUserMessageTask extends Task<string> {
    /**
     * @param text      - Full prompt to send (includes history/tools if any).
     * @param filePaths - Optional array of file paths.
     * @param userText  - Clean user text (used for language detection and RAG search).
     */
    constructor(
        private text: string,
        private filePaths?: string[],
        private userText?: string
    ) {
        const desc = filePaths && filePaths.length
            ? `Send message with ${filePaths.length} file(s)`
            : `Send message: ${text.substring(0, 50)}`;
        super(desc, 'normal');
        this.maxRetries = 0;
    }

    /**
     * Send the tools system prompt once per session, if tools were provided.
     *
     * The prompt is loaded from prompts/tools_prompt.txt. It teaches the
     * model that tools may appear in subsequent messages and that tool
     * calls must be pretty-printed raw JSON without markdown fences.
     */
    private async ensureToolsPrompt(client: DeepSeekClient, tools: any[]): Promise<void> {
        if (!tools || tools.length === 0) return;
        if (client.isSystemPromptSent('tools')) {
            console.log('ℹ️ Tools prompt already sent in this session');
            return;
        }

        console.log('🔧 Sending tools system prompt...');
        const toolsPrompt = loadPrompt('tools_prompt.txt', { required: true });

        const response = await client.executePipeline({
            text: toolsPrompt,
            skipStatsUpdate: true,
        });

        if (!response || !response.toUpperCase().includes('OK')) {
            console.warn(
                `⚠️ Expected "OK" from tools prompt, got: ${(response || '').substring(0, 100)}`
            );
        }
        client.setSystemPromptSent('tools');
        console.log('✅ Tools prompt sent');
    }

    /**
     * Send the multi-role system prompt once per session, if the
     * conversation contains more than one role or more than one message.
     *
     * The prompt is loaded from prompts/multirole_prompt.txt.
     */
    private async ensureMultiRolePrompt(client: DeepSeekClient, messages: any[]): Promise<void> {
        const hasSystem = messages.some(m => m.role === 'system');
        const hasMultipleUsers = messages.filter(m => m.role === 'user').length > 1;
        const hasAssistant = messages.some(m => m.role === 'assistant');

        if (!hasSystem && !hasMultipleUsers && !hasAssistant) return;
        if (client.isSystemPromptSent('multiRole')) {
            console.log('ℹ️ Multi-role prompt already sent in this session');
            return;
        }

        console.log('💬 Sending multi-role system prompt...');
        const multiRolePrompt = loadPrompt('multirole_prompt.txt', { required: true });

        const response = await client.executePipeline({
            text: multiRolePrompt,
            skipStatsUpdate: true,
        });

        if (!response || !response.toUpperCase().includes('OK')) {
            console.warn(
                `⚠️ Expected "OK" from multi-role prompt, got: ${(response || '').substring(0, 100)}`
            );
        }
        client.setSystemPromptSent('multiRole');
        console.log('✅ Multi-role prompt sent');
    }

    /**
     * Main execution.
     *
     * Order of operations:
     *   1. Analyze user text for language detection.
     *   2. If a context transition is pending, perform it first.
     *   3. Send the system prompts required by this request (once per session).
     *   4. Attach files to the DeepSeek UI.
     *   5. Send the message and wait for the response.
     *   6. Detect the length-limit banner and convert it into a 409 signal.
     *   7. Update the assigned chat ID and persist session state.
     *
     * File indexing for RAG is NOT done here. chat.js enqueues the files
     * into the background IndexingQueue after this task completes, using
     * the chatId assigned by DeepSeek.
     */
    async execute(client: DeepSeekClient): Promise<string> {
        if (this.userText) {
            client.contextManager.analyzeUserMessage(this.userText);
        }

        if (client.needTransition) {
            console.log('🚦 needTransition flag set, calling handleOverflow...');
            await client.handleOverflow();
            await client.saveChatState();
        }

        const tools = (global as any).currentTools || [];
        const messages = (global as any).currentMessages || [];

        await this.ensureToolsPrompt(client, tools);
        await this.ensureMultiRolePrompt(client, messages);

        if (this.filePaths && this.filePaths.length) {
            await client.fileUploader.upload(this.filePaths);
            await client.page!.waitForTimeout(500);
        }

        let messageText = this.text;
        if (!messageText && this.filePaths && this.filePaths.length) {
            messageText = 'Please analyze the uploaded file(s).';
        }

        client.lastLengthLimit = { detected: false, percent: null };
        const response = await client.executePipeline({
            text: messageText,
            filePath: undefined,
            skipStatsUpdate: false,
        });

        if (client.lastLengthLimit.detected) {
            console.warn(`⚠️ Length limit detected: ${client.lastLengthLimit.percent ?? 'no answer'}`);
            client.needTransition = false;
            client.lastLengthLimit = { detected: false, percent: null };
            throw new ContextExhaustedError('Length limit reached', response || '');
        }

        const newChatId = await client.chatController.getCurrentChatId();
        if (newChatId && newChatId !== client.currentChatId) {
            console.log(`📌 Chat ID assigned: ${newChatId}`);
            client.currentChatId = newChatId;
        }

        client.setChatStarted(true);
        await client.saveChatState();

        return response;
    }
}