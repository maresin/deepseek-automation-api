// src/utils/delays.ts
/**
 * @file src/utils/delays.ts
 * Tiny timing utility.
 */

/**
 * Pause the current async context for the given number of milliseconds.
 *
 * @param ms - Delay duration in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}