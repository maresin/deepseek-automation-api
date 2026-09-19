// src/utils/prompts.ts
/**
 * @file src/utils/prompts.ts
 * Unified loader for prompt files.
 *
 * All prompt files live in prompts/ by default, but the loader also accepts
 * absolute or project-relative paths, which is required for the system prompt
 * (its path is configurable via DEEPSEEK_SYSTEM_PROMPT_PATH).
 *
 * Resolution order for a missing or unreadable file:
 *   1. Return options.fallback if provided.
 *   2. Throw if options.required is true.
 *   3. Log a warning and return an empty string.
 */

import fs from 'fs';
import path from 'path';

/**
 * Resolve the full path to a prompt file.
 *
 * If the input contains a path separator, it is treated as a project-relative
 * or absolute path and used as-is. Otherwise it is resolved inside the
 * project's prompts/ directory.
 *
 * @param nameOrPath - Prompt file name (e.g. "system_prompt.txt") or a path.
 * @returns Absolute path to the prompt file.
 */
export function resolvePromptPath(nameOrPath: string): string {
    if (nameOrPath.includes('/') || nameOrPath.includes('\\')) {
        return path.isAbsolute(nameOrPath)
            ? nameOrPath
            : path.join(process.cwd(), nameOrPath);
    }
    return path.join(process.cwd(), 'prompts', nameOrPath);
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
 * The returned string is trimmed. See the module header for the resolution
 * order when the file is absent or unreadable.
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