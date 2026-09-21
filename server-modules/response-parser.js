// server-modules/response-parser.js
/**
 * @file server-modules/response-parser.js
 *
 * Parsing and normalization of tool_calls from the model's response.
 *
 * DeepSeek Web is a text interface: the model has no native tool-
 * calling channel. It may wrap its tool_calls JSON in markdown fences,
 * add conversational preamble, or (rarely) drop the closing brackets
 * on long compact output. This module handles all observed shapes and
 * always produces the OpenAI tool_calls format:
 *
 *   { id, type: "function", function: { name, arguments: "<json-string>" } }
 *
 * Extracted from chat.js so the logic can be unit-tested without a
 * running server. See algorithms B8 (extraction) and B9 (repair) in
 * docs/algorithms/response.md.
 */

/**
 * Remove a leading/trailing markdown code fence from text.
 * Handles ```json, ```javascript, ```js, and bare ```.
 *
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFences(text) {
    return text
        .replace(/^\s*```(?:json|javascript|js)?\s*\n?/i, '')
        .replace(/\n?\s*```\s*$/i, '')
        .trim();
}

/**
 * Extract the first complete top-level JSON object from text.
 *
 * Walks character by character, tracking:
 *   - brace depth (only `{` / `}` outside strings count)
 *   - string state (to skip `{` / `}` inside string literals)
 *   - escape state (to handle `\"` correctly)
 *
 * The naive alternative — a `\{.*\}` regex — fails on any JSON that
 * contains a `}` inside a string value. Tool-call arguments frequently
 * contain code (`if (x) { return 1; }`), so regex truncation is not
 * hypothetical. Brace balancing handles it correctly.
 *
 * Returns the parsed object, or null if no balanced JSON object is found.
 * Callers must try strict JSON.parse first; this is the fallback path.
 *
 * @param {string} text
 * @returns {object|null}
 */
function extractBalancedJson(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                const slice = text.substring(start, i + 1);
                try { return JSON.parse(slice); }
                catch { return null; }
            }
        }
    }
    return null;
}

/**
 * Normalize one tool_call entry into the OpenAI shape.
 *
 * The model may return either:
 *   - Flat:    { name, arguments }
 *   - Nested:  { function: { name, arguments } }
 *
 * `arguments` may be an object or a JSON string. A valid JSON string is
 * passed through verbatim; stringifying it again would produce a double-
 * encoded value that breaks clients expecting a single JSON.parse call.
 *
 * @param {object} tc     - Raw tool_call from the model.
 * @param {number} index  - Position in the array, used for id generation.
 * @returns {{ id: string, type: 'function', function: { name: string, arguments: string } }}
 */
function normalizeToolCall(tc, index) {
    const inner = tc.function && typeof tc.function === 'object' ? tc.function : tc;
    const name = inner.name;
    const rawArgs = inner.arguments;

    let argsString;
    if (typeof rawArgs === 'string') {
        // If it is already valid JSON, pass it through verbatim.
        try { JSON.parse(rawArgs); argsString = rawArgs; }
        catch { argsString = JSON.stringify(rawArgs); }
    } else {
        argsString = JSON.stringify(rawArgs ?? {});
    }

    return {
        id: tc.id || `call_${Date.now()}_${index}`,
        type: 'function',
        function: { name, arguments: argsString },
    };
}

/**
 * Close all unclosed brackets in a JSON fragment.
 *
 * Walks the text once, tracking unclosed `{` and `[` on a stack.
 * At the end, appends the matching closing brackets in reverse order.
 *
 * Returns the repaired string, or null if the fragment is
 * unrecoverable:
 *   - a closer appears with no matching opener (extra `}` / `]`),
 *   - a closer does not match the top of the stack (e.g. `}` inside `[`),
 *   - the fragment ends inside an unterminated string.
 *
 * The string-state and escape-state tracking means `{`, `}`, `[`, `]`
 * inside string values are correctly ignored — critical for tool_call
 * arguments that contain code.
 *
 * This function does NOT modify existing content. It only appends the
 * missing structural brackets.
 *
 * @param {string} text
 * @returns {string|null}
 */
function closeBrackets(text) {
    const stack = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if (ch === '}' || ch === ']') {
            if (stack.length === 0) return null;
            if (stack[stack.length - 1] !== ch) return null;
            stack.pop();
        }
    }

    // Truncated inside a string: the model stopped mid-value.
    // We cannot know where the string was supposed to end, so we
    // refuse to guess. The caller will surface this as content.
    if (inString) return null;

    // Already balanced — nothing to do.
    if (stack.length === 0) return null;

    return text + stack.reverse().join('');
}

/**
 * Attempt to repair a truncated tool_calls JSON fragment by appending
 * the missing closing brackets.
 *
 * Handles only one failure mode: the model produced complete, valid
 * content but forgot to close the outermost array and/or object.
 *
 * Does NOT attempt to recover fragments truncated mid-string. That
 * case is intentionally left to the caller: retrying the request with
 * a clarifying instruction is safer than silently dropping a partial
 * value.
 *
 * @param {string} text
 * @returns {{ parsed: object } | null}
 */
function repairTruncatedJson(text) {
    const closed = closeBrackets(text);
    if (!closed) return null;

    try {
        const parsed = JSON.parse(closed);
        if (parsed?.tool_calls?.length) {
            return { parsed };
        }
    } catch { /* not recoverable by closing brackets */ }

    return null;
}

/**
 * Parse a raw model response into either tool_calls or content.
 *
 * Three-stage strategy:
 *   1. Strict JSON.parse — covers the common case, zero overhead.
 *   2. Balanced-brace extraction from the raw text — handles fences,
 *      preamble, and code inside string values.
 *   3. Bracket-close repair — handles truncated JSON.
 *
 * Returns one of:
 *   { isToolCall: true,  parsed: { tool_calls: [...] }, wasTruncated: bool }
 *   { isToolCall: false, parsed: { content: <raw text> }, wasTruncated: false }
 *
 * @param {string} result - Raw model response text.
 * @returns {{ isToolCall: boolean, parsed: object, wasTruncated: boolean }}
 */
function parseResponse(result) {
    let parsedResponse = null;

    try {
        parsedResponse = JSON.parse(result);
    } catch { /* continue to fallback */ }

    if (!parsedResponse) {
        const cleaned = stripMarkdownFences(result);
        parsedResponse = extractBalancedJson(cleaned);
    }

    let wasTruncated = false;
    if (!parsedResponse && result.includes('"tool_calls"')) {
        const repaired = repairTruncatedJson(result);
        if (repaired) {
            parsedResponse = repaired.parsed;
            wasTruncated = true;
        }
    }

    if (parsedResponse?.tool_calls?.length) {
        return { isToolCall: true, parsed: parsedResponse, wasTruncated };
    }

    return {
        isToolCall: false,
        parsed: { content: result },
        wasTruncated: false,
    };
}

module.exports = {
    stripMarkdownFences,
    extractBalancedJson,
    normalizeToolCall,
    closeBrackets,
    repairTruncatedJson,
    parseResponse,
};