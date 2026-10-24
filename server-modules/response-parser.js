// server-modules/response-parser.js
/**
 * @file server-modules/response-parser.js
 *
 * Parsing and normalization of tool_calls from the model's response.
 *
 * DeepSeek Web is a text interface: the model has no native tool-
 * calling channel. Three shapes are observed in practice:
 *
 *   1. Strict JSON:          {"tool_calls": [{"name": ..., "arguments": {...}}]}
 *   2. JSON in markdown or   ...preamble... ```json { ... } ```
 *      with preamble:
 *   3. DSML markup:          <｜｜DSML｜｜ calls> ... <｜｜DSML｜｜ invoke> ... </｜｜DSML｜｜ calls>
 *
 * Shape (3) is DeepSeek's internal tool-call format, emitted when the
 * model decides to call a function via its native protocol instead of
 * following the "reply with JSON only" instruction. It is functionally
 * identical to (1) but wrapped in markup.
 *
 * All shapes are normalized to the OpenAI tool_calls format:
 *   { id, type: "function", function: { name, arguments: "<json-string>" } }
 *
 * See algorithms B8 (extraction), B9 (truncation repair), and
 * B6 (server busy detection) in docs/algorithms/response.md.
 */

/**
 * DSML tag prefix: "<｜｜DSML｜｜" where each ｜ is U+FF5C
 * (FULLWIDTH VERTICAL LINE). Written via \u escapes so the source
 * stays readable and does not depend on the file's encoding.
 */
const DSML_TAG = '\uFF5C\uFF5CDSML\uFF5C\uFF5C';

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
 * Walks character by character, tracking brace depth, string state,
 * and escape state. See B8 for the rationale vs. regex.
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
 * The model may return either flat { name, arguments } or nested
 * { function: { name, arguments } }. `arguments` may be an object or
 * a JSON string. A valid JSON string is passed through verbatim.
 *
 * @param {object} tc     - Raw tool_call.
 * @param {number} index  - Position in the array, for id generation.
 * @returns {{ id: string, type: 'function', function: { name: string, arguments: string } }}
 */
function normalizeToolCall(tc, index) {
    const inner = tc.function && typeof tc.function === 'object' ? tc.function : tc;
    const name = inner.name;
    const rawArgs = inner.arguments;

    let argsString;
    if (typeof rawArgs === 'string') {
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
 * Close all unclosed brackets in a JSON fragment. See B9.
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

    if (inString) return null;
    if (stack.length === 0) return null;

    return text + stack.reverse().join('');
}

/**
 * Attempt to repair a truncated tool_calls JSON fragment. See B9.
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
 * Detect and parse DSML tool-call markup into OpenAI tool_calls.
 *
 * DeepSeek's internal DSML format:
 *
 *   <｜｜DSML｜｜ calls>
 *   <｜｜DSML｜｜ invoke name="execute">
 *   <｜｜DSML｜｜ parameter name="arguments" string="false">{"script": "..."}</｜｜DSML｜｜ parameter>
 *   </｜｜DSML｜｜ invoke>
 *   </｜｜DSML｜｜ calls>
 *
 * Where:
 *   - Each <invoke> block represents one tool call.
 *   - name="X" is the function name.
 *   - Inside invoke, one or more <parameter> blocks.
 *   - parameter name="argName", string="false" (parse as JSON) or
 *     "true" (keep as string).
 *   - DeepSeek's convention is a single parameter named "arguments"
 *     holding the whole args object as JSON. Both conventions
 *     (wrapper-style and per-parameter) are handled.
 *
 * Lenient on closers: if the response is truncated mid-block, we
 * still attempt to extract what is there. This is the DSML analogue
 * of repairTruncatedJson for the JSON shape.
 *
 * @param {string} text - Raw model response.
 * @returns {{ tool_calls: object[], preamble: string } | null}
 *          Returns null if no DSML markup is present, or if the
 *          markup is present but no invoke blocks could be extracted.
 */
function parseDsml(text) {
    const invokeStart = new RegExp(
        `<${DSML_TAG}\\s*invoke\\s+name="([^"]+)"\\s*>`,
        'g'
    );

    // Quick check: bail out if no invoke opener at all.
    if (!invokeStart.test(text)) {
        return null;
    }
    invokeStart.lastIndex = 0; // reset after test()

    // Extract preamble: text before the first DSML marker.
    const firstDsmlIdx = text.search(
        new RegExp(`<${DSML_TAG}\\s*(?:calls|invoke)`)
    );
    const preamble = firstDsmlIdx > 0
        ? text.substring(0, firstDsmlIdx).trim()
        : '';

    const paramRegex = new RegExp(
        `<${DSML_TAG}\\s*parameter\\s+name="([^"]+)"` +
        `(?:\\s+string="(true|false)")?\\s*>` +
        `([\\s\\S]*?)` +
        `(?:</${DSML_TAG}\\s*parameter>|$)`,
        'g'
    );

    const toolCalls = [];
    let m;

    while ((m = invokeStart.exec(text)) !== null) {
        const fnName = m[1];
        const bodyStart = m.index + m[0].length;

        // Locate the end of this invoke block. Lenient: use whichever
        // comes first among </invoke>, next <invoke, </calls>, or EOT.
        const rest = text.substring(bodyStart);
        const closeIdx = rest.search(new RegExp(`</${DSML_TAG}\\s*invoke>`));
        const nextIdx = rest.search(new RegExp(`<${DSML_TAG}\\s*invoke\\s+name=`));
        const callsEndIdx = rest.search(new RegExp(`</${DSML_TAG}\\s*calls>`));

        let endIdx = rest.length;
        if (closeIdx !== -1) endIdx = closeIdx;
        else if (nextIdx !== -1) endIdx = Math.min(endIdx, nextIdx);
        else if (callsEndIdx !== -1) endIdx = Math.min(endIdx, callsEndIdx);

        const invokeBody = rest.substring(0, endIdx);

        // Parse parameters within this invoke.
        paramRegex.lastIndex = 0;
        const params = {};
        let p;
        while ((p = paramRegex.exec(invokeBody)) !== null) {
            const paramName = p[1];
            const isString = p[2] === 'true';
            const rawValue = p[3].trim();

            if (isString) {
                params[paramName] = rawValue;
            } else {
                try {
                    params[paramName] = JSON.parse(rawValue);
                } catch {
                    // Malformed JSON — keep raw. The client will see
                    // an error when it tries to parse arguments.
                    params[paramName] = rawValue;
                }
            }
        }

        // DeepSeek convention: single parameter "arguments" carries
        // the whole args object. Otherwise use params as-is.
        const finalArgs = 'arguments' in params
            ? params.arguments
            : params;

        toolCalls.push({
            id: `call_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: {
                name: fnName,
                arguments: typeof finalArgs === 'string'
                    ? finalArgs
                    : JSON.stringify(finalArgs),
            },
        });

        // Advance the outer regex past this invoke block.
        invokeStart.lastIndex = bodyStart + endIdx;
    }

    if (toolCalls.length === 0) {
        return null;
    }

    return { tool_calls: toolCalls, preamble };
}

/**
 * Parse a raw model response into either tool_calls or content.
 *
 * Stage order:
 *   1. Strict JSON.parse.
 *   2. Balanced-brace extraction (fences / preamble / nested braces).
 *   3. Bracket-close repair (truncated JSON).
 *   4. DSML markup parsing (truncated tolerant).
 *
 * If DSML markers are present but unparseable, the result carries
 * dsmlError=true so the caller can return a clear 500 instead of
 * passing raw markup through as content (which breaks the client's
 * tool-calling loop).
 *
 * @param {string} result - Raw model response text.
 * @returns {{
 *   isToolCall: boolean,
 *   parsed: object,
 *   wasTruncated: boolean,
 *   preamble?: string,
 *   dsmlError?: boolean
 * }}
 */
function parseResponse(result) {
    let parsedResponse = null;
    let wasTruncated = false;

    try {
        parsedResponse = JSON.parse(result);
    } catch { /* continue to fallback */ }

    if (!parsedResponse) {
        const cleaned = stripMarkdownFences(result);
        parsedResponse = extractBalancedJson(cleaned);
    }

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

    // DSML fallback.
    const dsml = parseDsml(result);
    if (dsml) {
        return {
            isToolCall: true,
            parsed: { tool_calls: dsml.tool_calls },
            wasTruncated: false,
            preamble: dsml.preamble,
        };
    }

    // DSML marker present but no invoke parsed — the markup is
    // malformed. Do not pass it through as content: the client would
    // try to process it as an answer and break.
    if (result.includes(`<${DSML_TAG} calls>`)) {
        console.warn(
            `⚠️ DSML markup present but no tool_calls could be extracted. ` +
            `preview: ${result.substring(0, 200)}`
        );
        return {
            isToolCall: false,
            parsed: { content: null },
            wasTruncated: false,
            dsmlError: true,
        };
    }

    // JSON marker present but no tool_calls extracted — existing warning.
    if (result.includes('"tool_calls"')) {
        console.warn(
            `⚠️ tool_calls marker present but not parsed. ` +
            `preview: ${result.substring(0, 200)}`
        );
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
    parseDsml,
    parseResponse,
};