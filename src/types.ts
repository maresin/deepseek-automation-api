// src/types.ts
/**
 * @file src/types.ts
 * Shared types for the DeepSeek client.
 */

export interface DeepSeekConfig {
    headless?: boolean;
    showBrowser?: boolean;
    viewport?: { width: number; height: number };
    statePath?: string;
}

export interface DeepSeekFeatures {
    deepThink?: boolean;
    webSearch?: boolean;
    attachments?: string[];
}

export interface SendMessageOptions {
    timeout?: number;
    waitForResponse?: boolean;
    maxResponseLength?: number;
    postResponseDelay?: number;
    filePath?: string;
    skipSystemPrompt?: boolean;
    skipStatsUpdate?: boolean;
    skipFileUpload?: boolean;
}

/**
 * Persistent chat-session state.
 * Stored in state.json under the "deepseek" key.
 */
export interface PersistentChatState {
    lastChatId: string | null;
    chatStarted: boolean;
    totalChars: number;
    ragSearchActive: boolean;
}

/**
 * Result of a RESTORE operation.
 */
export interface RestoreResult {
    ok: boolean;
    reason?: 'chat_not_found' | 'no_last_chat_id' | 'unknown';
}

export class DeepSeekError extends Error {
    constructor(
        message: string,
        public code: string,
        public originalError?: Error
    ) {
        super(message);
        this.name = 'DeepSeekError';
    }
}

/**
 * Thrown when DeepSeek reports that the current chat session has reached
 * its context limit. Both known banner formulations are treated identically.
 */
export class ContextExhaustedError extends Error {
    public chatId: string | null = null;
    public charsUsed: number = 0;
    public charsLimit: number = 0;
    public deepseekReadablePercent: number | null = null;
    public partialResponse: string = '';
    public ragEnabled: boolean = false;
    public bannerText: string = '';

    constructor(bannerText: string, partialResponse: string = '') {
        super('DeepSeek context limit reached');
        this.name = 'ContextExhaustedError';
        this.bannerText = bannerText;
        this.partialResponse = partialResponse;
    }
}

/**
 * Thrown when DeepSeek responds with the "Server busy, please try again
 * later" placeholder instead of an assistant message.
 *
 * This is a fatal condition by project policy: the HTTP layer sends 503
 * to the current client and then terminates the process. Retrying is not
 * attempted — experience shows the backend stays unavailable for hours.
 */
export class ServerBusyError extends Error {
    constructor(message = 'DeepSeek backend is not responding') {
        super(message);
        this.name = 'ServerBusyError';
    }
}