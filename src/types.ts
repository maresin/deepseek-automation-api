// src/types.ts
// Type definitions for DeepSeek Automation API

// Configuration options for the DeepSeek client
export interface DeepSeekConfig {
    headless?: boolean;      // Run browser without UI (may trigger anti-bot)
    showBrowser?: boolean;   // Show browser window (deprecated, use headless)
    viewport?: { width: number; height: number };  // Browser window size
    statePath?: string;      // Custom path for session state file
}

// Features that can be enabled per request
export interface DeepSeekFeatures {
    deepThink?: boolean;     // Enable DeepThink (R1) reasoning mode
    webSearch?: boolean;     // Enable web search for real-time info
    attachments?: string[];  // File paths to upload
}

// Additional options for sendMessage
export interface SendMessageOptions {
    timeout?: number;        // Max wait time for response (ms)
    waitForResponse?: boolean; // Whether to wait for full response
    maxResponseLength?: number; // Maximum response length in chars
}

// Response structure from sendMessage
export interface DeepSeekResponse {
    content: string;         // Response text or tool calls JSON
    duration: number;        // Request duration in milliseconds
    featuresUsed: DeepSeekFeatures; // Which features were enabled
    estimatedTokens: number; // Approximate token usage
}

// Custom error class
export class DeepSeekError extends Error {
    constructor(
        message: string,
        public code: string,           // Error code (INIT_ERROR, SEND_ERROR, etc.)
        public originalError?: Error   // Original error if any
    ) {
        super(message);
        this.name = 'DeepSeekError';
    }
}