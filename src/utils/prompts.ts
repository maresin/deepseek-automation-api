// src/utils/prompts.ts
/**
 * @file src/utils/prompts.ts
 * Unified loader for prompt files.
 *
 * Prompt files live under <api-root>/prompts/. Their location is
 * resolved relative to THIS MODULE, not to the process working
 * directory. This matters for multi-agent deployments: each agent
 * runs in its own subdirectory (agents/agent-N/), so process.cwd()
 * points there, not to the API root. A cwd-relative lookup would
 * fail to find prompts even though they are installed correctly.
 *
 * Resolution order for a missing or unreadable file:
 *   1. Return options.fallback if provided.
 *   2. Throw if options.required is true.
 *   3. Log a warning and return an empty string.
 */

import fs from 'fs';
import path from 'path';

/**
 * Absolute path to the API root directory.
 *
 * This file is at <api-root>/src/utils/prompts.ts in development and
 * at <api-root>/dist/utils/prompts.js in production. In both cases
 * two levels up from __dirname is the API root.
 */
const API_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Resolve the full path to a prompt file.
 *
 * If the input contains a path separator, it is treated as an
 * API-root-relative or absolute path. Otherwise it is resolved
 * inside the API's prompts/ directory.
 *
 * @param nameOrPath - Prompt file name (e.g. "tools_prompt.txt")
 *                     or a path relative to the API root.
 * @returns Absolute path to the prompt file.
 */
export function resolvePromptPath(nameOrPath: string): string {
    if (path.isAbsolute(nameOrPath)) {
        return nameOrPath;
    }
    if (nameOrPath.includes('/') || nameOrPath.includes('\\')) {
        return path.join(API_ROOT, nameOrPath);
    }
    return path.join(API_ROOT, 'prompts', nameOrPath);
}

export interface LoadPromptOptions {
    /** Text returned when the file is missing or unreadable. */
    fallback?: string;
    /** Throw an error instead of returning an empty string when missing. */
    required?: boolean;
}

/**
 * Load a prompt file with a unified fallback policy.
 *
 * The returned string is trimmed. See the module header for the
 * resolution order when the file is absent or unreadable.
 *
 * @param nameOrPath - Prompt file name or path.
 * @param options - Fallback text and required-mode flag.
 * @returns Prompt contents (trimmed), the fallback text, or an empty string.
 * @throws {Error} If the file is missing and options.required is true.
 */
export function loadPrompt(nameOrPath: string, options: LoadPromptOptions = {}): string {
    const { fallback, required = false } = options;
    const fullPath = resolvePromptPath(nameOrPath);

    if (fs.existsSync(fullPath)) {
        try {
            return fs.readFileSync(fullPath, 'utf-8').trim();
        } catch (err) {
            console.warn(`⚠️ Could not read prompt ${fullPath}: ${(err as Error).message}`);
        }
    }

    if (fallback !== undefined) return fallback;

    if (required) {
        throw new Error(`Prompt file not found: ${fullPath}`);
    }

    console.warn(`⚠️ Prompt file not found: ${fullPath}`);
    return '';
}