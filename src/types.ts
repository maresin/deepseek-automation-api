// src/types.ts
export interface DeepSeekConfig {
    headless?: boolean;
    showBrowser?: boolean;
    viewport?: { width: number; height: number };
    statePath?: string;
}

export interface DeepSeekFeatures {
    deepThink?: boolean;
    webSearch?: boolean;
    expertMode?: boolean;
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

export interface DeepSeekResponse {
    content: string;
    duration: number;
    featuresUsed: DeepSeekFeatures;
    estimatedTokens: number;
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