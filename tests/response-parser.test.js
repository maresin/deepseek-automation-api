// tests/response-parser.test.js
/**
 * Unit tests for server-modules/response-parser.js.
 *
 * Run:
 *   npm run test:unit
 *
 * No server, no Playwright, no network. Runs in milliseconds.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// response-parser.js is CommonJS. Import via default to avoid any
// cjs-module-lexer ambiguity.
import parser from '../server-modules/response-parser.js';

const {
    stripMarkdownFences,
    extractBalancedJson,
    normalizeToolCall,
    closeBrackets,
    repairTruncatedJson,
    parseResponse,
} = parser;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// stripMarkdownFences
// ============================================================

test('stripMarkdownFences: removes ```json wrapper', () => {
    assert.equal(stripMarkdownFences('```json\n{"a": 1}\n```'), '{"a": 1}');
});

test('stripMarkdownFences: removes ```javascript wrapper', () => {
    assert.equal(stripMarkdownFences('```javascript\n{"a": 1}\n```'), '{"a": 1}');
});

test('stripMarkdownFences: removes bare ``` wrapper', () => {
    assert.equal(stripMarkdownFences('```\n{"a": 1}\n```'), '{"a": 1}');
});

test('stripMarkdownFences: leaves unfenced text alone', () => {
    assert.equal(stripMarkdownFences('{"a": 1}'), '{"a": 1}');
});

// ============================================================
// extractBalancedJson
// ============================================================

test('extractBalancedJson: parses a simple object', () => {
    assert.deepEqual(extractBalancedJson('{"a": 1}'), { a: 1 });
});

test('extractBalancedJson: skips preamble', () => {
    assert.deepEqual(
        extractBalancedJson('Here is the result:\n{"a": 1}\nThanks.'),
        { a: 1 }
    );
});

test('extractBalancedJson: handles braces inside strings', () => {
    assert.deepEqual(
        extractBalancedJson('{"code": "if (x) { return 1; }"}'),
        { code: 'if (x) { return 1; }' }
    );
});

test('extractBalancedJson: handles nested objects', () => {
    assert.deepEqual(
        extractBalancedJson('{"outer": {"inner": {"deep": 1}}}'),
        { outer: { inner: { deep: 1 } } }
    );
});

test('extractBalancedJson: handles escaped quotes', () => {
    assert.deepEqual(
        extractBalancedJson('{"text": "say \\"hi\\""}'),
        { text: 'say "hi"' }
    );
});

test('extractBalancedJson: returns null for no JSON', () => {
    assert.equal(extractBalancedJson('no json here'), null);
});

// ============================================================
// normalizeToolCall
// ============================================================

test('normalizeToolCall: flat format with object arguments', () => {
    const out = normalizeToolCall({ name: 'echo', arguments: { text: 'hello' } }, 0);
    assert.equal(out.type, 'function');
    assert.equal(out.function.name, 'echo');
    assert.equal(out.function.arguments, '{"text":"hello"}');
    assert.match(out.id, /^call_/);
});

test('normalizeToolCall: nested function format', () => {
    const out = normalizeToolCall(
        { function: { name: 'echo', arguments: { text: 'hi' } } },
        0
    );
    assert.equal(out.function.name, 'echo');
    assert.equal(out.function.arguments, '{"text":"hi"}');
});

test('normalizeToolCall: string arguments pass through verbatim', () => {
    const out = normalizeToolCall({ name: 'echo', arguments: '{"text":"hi"}' }, 0);
    assert.equal(out.function.arguments, '{"text":"hi"}');
});

test('normalizeToolCall: non-JSON string is wrapped as a JSON string', () => {
    const out = normalizeToolCall({ name: 'echo', arguments: 'not-json' }, 0);
    assert.equal(JSON.parse(out.function.arguments), 'not-json');
});

test('normalizeToolCall: preserves provided id', () => {
    const out = normalizeToolCall({ id: 'my-id', name: 'echo', arguments: {} }, 0);
    assert.equal(out.id, 'my-id');
});

test('normalizeToolCall: array arguments', () => {
    const out = normalizeToolCall(
        { name: 'write', arguments: { files: [{ path: 'a.txt' }] } },
        0
    );
    const parsed = JSON.parse(out.function.arguments);
    assert.deepEqual(parsed.files, [{ path: 'a.txt' }]);
});

// ============================================================
// closeBrackets
// ============================================================

test('closeBrackets: adds missing closing brackets', () => {
    assert.equal(closeBrackets('{"a": [1, 2'), '{"a": [1, 2]}');
});

test('closeBrackets: handles deep nesting', () => {
    assert.equal(closeBrackets('{"a": [{"b": [1'), '{"a": [{"b": [1]}]}');
});

test('closeBrackets: returns null for mid-string truncation', () => {
    assert.equal(closeBrackets('{"a": "unterminated'), null);
});

test('closeBrackets: returns null for extra closers', () => {
    assert.equal(closeBrackets('{"a": 1}}'), null);
});

test('closeBrackets: returns null for already balanced', () => {
    assert.equal(closeBrackets('{"a": 1}'), null);
});

test('closeBrackets: ignores braces inside strings', () => {
    const input = '{"code": "if (x) { return 1; }"';
    assert.equal(closeBrackets(input), '{"code": "if (x) { return 1; }"}');
});

test('closeBrackets: ignores escaped quotes', () => {
    assert.equal(
        closeBrackets('{"text": "say \\"hi\\""'),
        '{"text": "say \\"hi\\""}'
    );
});

// ============================================================
// repairTruncatedJson
// ============================================================

test('repairTruncatedJson: recovers truncated tool_calls', () => {
    const input = '{"tool_calls": [{"name": "echo", "arguments": {"text": "hi"';
    const result = repairTruncatedJson(input);
    assert.ok(result);
    assert.equal(result.parsed.tool_calls.length, 1);
    assert.equal(result.parsed.tool_calls[0].name, 'echo');
});

test('repairTruncatedJson: returns null for mid-string truncation', () => {
    const input = '{"tool_calls": [{"name": "echo", "arguments": {"text": "unter';
    assert.equal(repairTruncatedJson(input), null);
});

test('repairTruncatedJson: returns null without tool_calls', () => {
    assert.equal(repairTruncatedJson('{"other": [1, 2'), null);
});

// ============================================================
// parseResponse — end-to-end
// ============================================================

test('parseResponse: plain text becomes content', () => {
    const r = parseResponse('Hello, world.');
    assert.equal(r.isToolCall, false);
    assert.equal(r.parsed.content, 'Hello, world.');
    assert.equal(r.wasTruncated, false);
});

test('parseResponse: clean JSON tool_calls', () => {
    const input = JSON.stringify({
        tool_calls: [{ name: 'echo', arguments: { text: 'hi' } }],
    });
    const r = parseResponse(input);
    assert.equal(r.isToolCall, true);
    assert.equal(r.wasTruncated, false);
    assert.equal(r.parsed.tool_calls.length, 1);
});

test('parseResponse: markdown-fenced JSON', () => {
    const input = '```json\n{"tool_calls": [{"name": "echo", "arguments": {}}]}\n```';
    const r = parseResponse(input);
    assert.equal(r.isToolCall, true);
    assert.equal(r.wasTruncated, false);
});

test('parseResponse: preamble before JSON', () => {
    const input = 'Here you go:\n{"tool_calls": [{"name": "echo", "arguments": {}}]}';
    const r = parseResponse(input);
    assert.equal(r.isToolCall, true);
    assert.equal(r.wasTruncated, false);
});

test('parseResponse: truncated brackets', () => {
    const input = '{"tool_calls": [{"name": "echo", "arguments": {"text": "hi"';
    const r = parseResponse(input);
    assert.equal(r.isToolCall, true);
    assert.equal(r.wasTruncated, true);
});

test('parseResponse: mid-string truncation falls back to content', () => {
    const input = '{"tool_calls": [{"name": "echo", "arguments": {"text": "unter';
    const r = parseResponse(input);
    assert.equal(r.isToolCall, false);
    assert.equal(r.wasTruncated, false);
});

test('parseResponse: real-world truncated fixture', () => {
    const fixturePath = path.join(__dirname, 'data', 'truncated-write_files.json');

    if (!fs.existsSync(fixturePath)) {
        console.warn(`⊘ fixture not found: ${fixturePath}`);
        return;
    }

    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const r = parseResponse(raw);

    assert.equal(r.isToolCall, true, 'fixture should parse as tool_calls');
    assert.equal(r.wasTruncated, true, 'fixture should be marked truncated');
    assert.ok(r.parsed.tool_calls.length >= 1);
    assert.equal(r.parsed.tool_calls[0].name, 'write_files');
    assert.ok(Array.isArray(r.parsed.tool_calls[0].arguments.files));
    assert.ok(r.parsed.tool_calls[0].arguments.files.length >= 1);
});