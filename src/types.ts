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
 * Which placeholder triggered the busy condition.
 *
 *   - 'busy'  — the "Server busy" / "Messages too frequent" marker
 *               was found in the DOM. DeepSeek needs minutes to cool
 *               down before the next attempt.
 *   - 'empty' — the response was empty but no busy marker was found.
 *               Treated as a transient failure; shorter retry delay.
 */
export type BusyKind = 'busy' | 'empty';

/**
 * Thrown when the server-busy placeholder persists after every retry.
 *
 * The API retries the request internally before throwing this. The
 * number of retries and the delay between them are controlled by
 * DEEPSEEK_BUSY_MAX_RETRIES and DEEPSEEK_BUSY_DELAY_MS. When those
 * are exhausted, this error carries the number of attempts made and
 * the kind of failure so the HTTP layer can return a detailed 503
 * with a Retry-After header.
 *
 * The previous behaviour — throwing on the first sighting and
 * calling process.exit(1) — is available via
 * DEEPSEEK_SHUTDOWN_ON_SERVER_BUSY=true, but is no longer the
 * default: an autonomous agent should survive a busy backend.
 */
export class ServerBusyError extends Error {
    constructor(public details: {
        kind: BusyKind;
        attempts: number;
    }) {
        const label = details.kind === 'busy'
            ? 'server busy'
            : 'empty response';
        super(
            `DeepSeek ${label} after ${details.attempts} attempt(s). ` +
            `The backend may be temporarily unavailable.`
        );
        this.name = 'ServerBusyError';
    }
}