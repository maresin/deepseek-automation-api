#!/usr/bin/env node
/**
 * @file tests/selector-tests/selector-browser-test.js
 *
 * Validates every CSS selector in src/browser/Selectors.ts against the live
 * DeepSeek UI. This is an integration test against an external system that
 * we do not control: the selectors are assumptions about DeepSeek's DOM,
 * and this test checks that those assumptions still hold.
 *
 * Independent from the API server. Does not require a running server, does
 * not read chat_state.json, does not depend on the Selectors catalog under
 * docs/. Only state.json (browser cookies) is required to reach the chat
 * page without manual login.
 *
 * Usage:
 *   node tests/selector-tests/selector-browser-test.js
 *   SELECTOR_TEST_OVERLAY=false node tests/selector-tests/selector-browser-test.js
 *   SELECTOR_TEST_HEADLESS=true  node tests/selector-tests/selector-browser-test.js
 *
 * Exit code: 0 if all selectors found, 1 otherwise.
 */

import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Selectors } from '../../dist/browser/Selectors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const STATE_PATH = path.join(PROJECT_ROOT, 'state.json');

const SHOW_OVERLAY = process.env.SELECTOR_TEST_OVERLAY !== 'false';
const HEADLESS = process.env.SELECTOR_TEST_HEADLESS === 'true';

const DELAYS = {
    HIGHLIGHT_MS: 400,
    AFTER_ACTION_MS: 800,
    BETWEEN_TESTS: 200,
    PAGE_LOAD_TIMEOUT_MS: 30000,
};

let TOTAL = 0;
let PASSED = 0;
let FAILED = 0;
let PAGE = null;

// ============================================================
// OVERLAY
// ============================================================

async function createOverlay(page) {
    if (!SHOW_OVERLAY) return;
    await page.evaluate(() => {
        const old = document.getElementById('selector-test-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'selector-test-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 340px;
            max-height: 70vh;
            overflow-y: auto;
            background: rgba(0, 0, 0, 0.78);
            color: #ddd;
            padding: 12px 14px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            z-index: 2147483647;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
            border: 1px solid #333;
            backdrop-filter: blur(4px);
            pointer-events: none;
        `;
        overlay.innerHTML = `
            <div style="font-size:13px;font-weight:bold;padding-bottom:6px;border-bottom:1px solid #444;color:#bbb;letter-spacing:0.5px;">
                🧪 SELECTOR TEST
            </div>
            <div id="selector-test-status" style="font-size:11px;color:#888;margin:8px 0;">
                Starting…
            </div>
            <div id="selector-test-list" style="max-height:calc(70vh - 80px);overflow-y:auto;"></div>
        `;
        document.body.appendChild(overlay);
    });
}

async function updateOverlayCurrent(page, name) {
    if (!SHOW_OVERLAY) return;
    await page.evaluate((n) => {
        const s = document.getElementById('selector-test-status');
        if (s) s.textContent = `Checking: ${n}`;
    }, name);
}

async function updateOverlayResult(page, name, found) {
    if (!SHOW_OVERLAY) return;
    await page.evaluate(({ n, ok }) => {
        const list = document.getElementById('selector-test-list');
        if (!list) return;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #2a2a2a;font-size:10px;';
        const icon = ok ? '✓' : '✗';
        const color = ok ? '#6a6' : '#c44';
        row.innerHTML = `
            <span style="color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;">${icon} ${n}</span>
        `;
        list.appendChild(row);
        list.scrollTop = list.scrollHeight;
    }, { n: name, ok: found });
}

async function setOverlaySummary(page) {
    if (!SHOW_OVERLAY) return;
    await page.evaluate(({ p, t, f }) => {
        const s = document.getElementById('selector-test-status');
        if (s) {
            const color = f === 0 ? '#6a6' : '#c44';
            s.innerHTML = `<span style="color:${color}">📊 ${p}/${t} passed${f ? `, ${f} failed` : ''}</span>`;
        }
    }, { p: PASSED, t: TOTAL, f: FAILED });
}

// ============================================================
// HIGHLIGHT
// ============================================================

/**
 * Outline the matched element for a moment and scroll it into view.
 * Silently does nothing if the selector does not match anything.
 */
async function highlight(page, selector, durationMs = DELAYS.HIGHLIGHT_MS) {
    try {
        const ok = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            el.style.outline = '3px solid #ff6b35';
            el.style.outlineOffset = '2px';
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return true;
        }, selector);
        if (!ok) return false;
        await page.waitForTimeout(durationMs);
        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                el.style.outline = '';
                el.style.outlineOffset = '';
            }
        }, selector);
        return true;
    } catch {
        return false;
    }
}

// ============================================================
// TEST RUNNER
// ============================================================

function logGroup(name) {
    console.log('\n═══════════════════════════════════════');
    console.log(`📌 ${name}`);
    console.log('═══════════════════════════════════════');
}

/**
 * Run one selector test.
 *
 * @param {string} name - Human-readable test name.
 * @param {string} selector - CSS selector or Playwright locator expression.
 * @param {object} [opts]
 * @param {string} [opts.description] - Extra context shown in the log.
 * @param {Function} [opts.before] - Async precondition (page) => Promise.
 * @param {Function} [opts.after] - Async cleanup (page) => Promise.
 * @param {boolean|'any'} [opts.expected] - true (default): must be found.
 *                                          false: must not be found.
 *                                          'any': informational, does not fail.
 */
async function test(name, selector, opts = {}) {
    TOTAL++;
    console.log(`\n[${TOTAL}] ${name}${opts.description ? ' — ' + opts.description : ''}`);
    await updateOverlayCurrent(PAGE, name);

    let found = false;
    let error = null;
    let threw = false;

    try {
        if (opts.before) await opts.before(PAGE);
        const el = await PAGE.$(selector);
        found = el !== null;
        if (found) await highlight(PAGE, selector);
    } catch (err) {
        error = err.message;
        threw = true;
    } finally {
        if (opts.after) {
            try { await opts.after(PAGE); } catch { /* ignore */ }
        }
    }

    let passed;
    let detail;

    if (opts.expected === 'any') {
        passed = !threw;
        detail = found ? 'found (informational)' : 'not found (informational)';
    } else {
        const expected = opts.expected !== undefined ? opts.expected : true;
        passed = !threw && (found === expected);
        detail = found
            ? 'found'
            : (expected ? 'not found' : 'correctly absent');
    }

    if (passed) PASSED++;
    else FAILED++;

    const icon = passed ? '✅' : '❌';
    console.log(`  ${icon} ${detail}${error ? ` — ${error}` : ''}`);

    await updateOverlayResult(PAGE, name, passed);
    await PAGE.waitForTimeout(DELAYS.BETWEEN_TESTS);
}

// ============================================================
// UI STATE HELPERS
// ============================================================

async function isSidebarExpanded(page) {
    return await page.getByText('New chat').isVisible().catch(() => false);
}

async function expandSidebar(page) {
    if (await isSidebarExpanded(page)) return;
    const toggle = await page.$(Selectors.sidebarToggle);
    if (toggle) {
        await toggle.click();
        await page.waitForTimeout(DELAYS.AFTER_ACTION_MS);
    }
}

async function collapseSidebar(page) {
    if (!await isSidebarExpanded(page)) return;
    const toggle = await page.$(Selectors.sidebarToggle);
    if (toggle) {
        await toggle.click();
        await page.waitForTimeout(DELAYS.AFTER_ACTION_MS);
    }
}

/**
 * Open the profile menu, idempotently.
 *
 * The profile icon shares its SVG path with the per-chat context menu
 * icon, so we must iterate from the end of the list — the profile is
 * always the bottommost match in the sidebar.
 */
async function openProfileMenu(page) {
    // If the menu is already open, do not toggle it closed.
    if (await page.$(Selectors.settingsMenuItem)) return true;

    const opened = await page.evaluate(() => {
        const icons = Array.from(document.querySelectorAll('.ds-icon'));
        for (let i = icons.length - 1; i >= 0; i--) {
            const icon = icons[i];
            const svg = icon.querySelector('svg');
            if (svg && svg.innerHTML.includes('M4.55146 8.00001')) {
                const parent = icon.closest('[tabindex="0"]');
                if (parent) {
                    parent.click();
                    return true;
                }
            }
        }
        return false;
    });
    if (opened) await page.waitForTimeout(DELAYS.AFTER_ACTION_MS);
    return opened;
}

async function closeProfileMenu(page) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(DELAYS.AFTER_ACTION_MS);
}

// ============================================================
// MAIN
// ============================================================

async function run() {
    console.log('🧪 Selector browser test');
    console.log(`🔗 state.json: ${STATE_PATH}`);
    console.log(`🎨 overlay:    ${SHOW_OVERLAY ? 'on' : 'off'}`);
    console.log(`👻 headless:   ${HEADLESS ? 'yes' : 'no'}`);

    if (!fs.existsSync(STATE_PATH)) {
        console.error(`❌ state.json not found at ${STATE_PATH}. Log in manually first.`);
        process.exit(1);
    }

    const pathsMod = await import('../../dist/utils/paths.js');
    const browser = await chromium.launch({
        headless: HEADLESS,
        executablePath: pathsMod.getChromiumExecutablePath(),
    });
    const context = await browser.newContext({
        storageState: STATE_PATH,
        permissions: ['clipboard-read', 'clipboard-write'],
    });
    PAGE = await context.newPage();

    console.log('\n🌐 Opening DeepSeek…');
    await PAGE.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded' });
    await PAGE.waitForSelector(Selectors.mainTextarea, { timeout: DELAYS.PAGE_LOAD_TIMEOUT_MS });
    console.log('✅ Page loaded');

    await createOverlay(PAGE);

    // ============================================================
    // GROUP 1 — Base chat page
    // ============================================================
    logGroup('Base chat page');

    await test('mainTextarea', Selectors.mainTextarea);
    await test('sendButtonExists', Selectors.sendButtonExists,
        { description: 'may be disabled until text is entered' });
    await test('attachButton', Selectors.attachButton);
    await test('fileInput', Selectors.fileInput,
        { description: 'hidden input, attached to attachButton' });
    await test('deepThinkButton', Selectors.deepThinkButton);
    await test('webSearchButton', Selectors.webSearchButton);
    await test('sidebarToggle', Selectors.sidebarToggle);

    // ============================================================
    // GROUP 2 — Sidebar (collapsed / expanded)
    // ============================================================
    logGroup('Sidebar variants');

    await test('newChatButtonIcon', Selectors.newChatButtonIcon, {
        description: 'icon variant — only visible when sidebar is collapsed',
        before: collapseSidebar,
        after: expandSidebar,
    });

    await test('chatHistoryLink', Selectors.chatHistoryLink, {
        description: 'present when at least one chat exists',
        before: expandSidebar,
    });

    await test('chatContextMenu', Selectors.chatContextMenu, {
        description: 'appears when hovering a chat entry',
        before: async (page) => {
            await expandSidebar(page);
            const link = await page.$('a[href^="/a/chat/s/"]');
            if (link) await link.hover();
            await page.waitForTimeout(DELAYS.AFTER_ACTION_MS);
        },
    });

    // ============================================================
    // GROUP 3 — Profile menu
    // ============================================================
    logGroup('Profile menu');

    // The profile menu stays open after this test so that the following
    // Settings tests can operate inside it without re-opening.
    await test('settingsMenuItem', Selectors.settingsMenuItem, {
        before: openProfileMenu,
    });

    // ============================================================
    // GROUP 4 — Settings dialog
    // ============================================================
    logGroup('Settings dialog');

    await test('languageSelect', Selectors.languageSelect, {
        before: async (page) => {
            // The profile menu is already open from the previous test.
            // Clicking Settings opens the dialog, which stays open for
            // the remaining Settings-group tests.
            const item = await page.$(Selectors.settingsMenuItem);
            if (item) {
                await item.click();
                await page.waitForTimeout(DELAYS.AFTER_ACTION_MS * 2);
            }
        },
    });

    await test('settingsTabGeneral', Selectors.settingsTabGeneral);
    await test('settingsClose', Selectors.settingsClose);

    await test('languageOptionEnglish', Selectors.languageOptionEnglish, {
        description: 'inside the language dropdown',
        before: async (page) => {
            const sel = await page.$(Selectors.languageSelect);
            if (sel) {
                await sel.click();
                await page.waitForTimeout(DELAYS.AFTER_ACTION_MS);
            }
        },
        after: async (page) => {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(DELAYS.AFTER_ACTION_MS);
        },
    });

    // Close settings after the group
    await PAGE.keyboard.press('Escape').catch(() => {});
    await PAGE.waitForTimeout(DELAYS.AFTER_ACTION_MS);

    // ============================================================
    // GROUP 5 — Generation control (Stop, Continue)
    // ============================================================
    logGroup('Generation control');

    /**
     * Send a prompt long enough to guarantee that the Stop button appears.
     * Returns once the Stop button is visible in the DOM.
     */
    async function startLongGeneration(page, prompt) {
        await page.click(Selectors.mainTextarea);
        await page.waitForTimeout(200);
        await page.keyboard.insertText(prompt);
        await page.waitForTimeout(500);
        const send = await page.$(Selectors.sendButton);
        if (send) await send.click();
        // Wait for Stop to appear — marks that generation has started
        for (let i = 0; i < 30; i++) {
            if (await page.$(Selectors.stopButton)) return true;
            await page.waitForTimeout(500);
        }
        return false;
    }

    /**
     * Wait for the Stop button to disappear — the model has finished the
     * current chunk and either completed or paused for Continue.
     */
    async function waitForStopToDisappear(page, timeoutMs = 120000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!await page.$(Selectors.stopButton)) return true;
            await page.waitForTimeout(1000);
        }
        return false;
    }

    const LONG_PROMPT =
        'Write a very long essay about the history of computing, at least 3000 words. ' +
        'Divide it into clear sections and keep writing until you run out of context.';

    // ---- stopButton + continueButton in one flow ----
    TOTAL++;
    console.log(`\n[${TOTAL}] stopButton — appears during generation`);
    await updateOverlayCurrent(PAGE, 'stopButton');

    let stopFound = false;
    let continueFound = false;

    try {
        const started = await startLongGeneration(PAGE, LONG_PROMPT);
        stopFound = started && !!(await PAGE.$(Selectors.stopButton));
        if (stopFound) await highlight(PAGE, Selectors.stopButton);
    } catch { /* ignore */ }

    if (stopFound) PASSED++; else FAILED++;
    console.log(`  ${stopFound ? '✅' : '❌'} ${stopFound ? 'found' : 'not found'}`);
    await updateOverlayResult(PAGE, 'stopButton', stopFound);
    await PAGE.waitForTimeout(DELAYS.BETWEEN_TESTS);

    // Interrupt generation by clicking Stop
    console.log(`\n[${TOTAL + 1}] continueButton — appears after clicking Stop`);
    await updateOverlayCurrent(PAGE, 'continueButton');

    try {
        const stopEl = await PAGE.$(Selectors.stopButton);
        if (stopEl) {
            await stopEl.click();
            // Give the UI a moment to swap Stop → Continue
            await PAGE.waitForTimeout(1500);
        }
        continueFound = !!(await PAGE.$(Selectors.continueButton));
        if (continueFound) await highlight(PAGE, Selectors.continueButton);
    } catch { /* ignore */ }

    TOTAL++;
    if (continueFound) PASSED++; else FAILED++;
    console.log(`  ${continueFound ? '✅' : '❌'} ${continueFound ? 'found' : 'not found'}`);
    await updateOverlayResult(PAGE, 'continueButton', continueFound);
    await PAGE.waitForTimeout(DELAYS.BETWEEN_TESTS);

    // Resume generation — proves the button is actionable, not just visible
    if (continueFound) {
        console.log(`\n[${TOTAL + 1}] continueButton — click resumes generation`);
        await updateOverlayCurrent(PAGE, 'continue (click)');

        let resumed = false;
        try {
            const contEl = await PAGE.$(Selectors.continueButton);
            if (contEl) {
                await contEl.click();
                // After clicking Continue, Stop must reappear — generation resumed
                for (let i = 0; i < 30; i++) {
                    if (await PAGE.$(Selectors.stopButton)) { resumed = true; break; }
                    await PAGE.waitForTimeout(500);
                }
            }
        } catch { /* ignore */ }

        TOTAL++;
        if (resumed) PASSED++; else FAILED++;
        console.log(`  ${resumed ? '✅' : '❌'} ${resumed ? 'generation resumed' : 'generation did not resume'}`);
        await updateOverlayResult(PAGE, 'continue (click)', resumed);
        await PAGE.waitForTimeout(DELAYS.BETWEEN_TESTS);
    }

    // Let the generation finish before the next group
    await waitForStopToDisappear(PAGE, 180000);

    // ---- informational selectors ----
    await test('loadingIndicator', Selectors.loadingIndicator, {
        description: 'may not be present if the response completed instantly',
        expected: 'any',
    });

    await test('virtualListItem', Selectors.virtualListItem, {
        description: 'present once the chat contains at least one message',
    });

    await test('markdownBodyRelative', Selectors.markdownBodyRelative, {
        description: 'fallback extractor — present when the last message is an assistant reply',
        expected: 'any',
    });

    await test('scrollToBottomButton', Selectors.scrollToBottomButton, {
        description: 'only visible when scrolled up on a long response',
        expected: 'any',
    });

    // ============================================================
    // SUMMARY
    // ============================================================
    await setOverlaySummary(PAGE);

    console.log('\n═══════════════════════════════════════');
    console.log(`📊 Summary: ${PASSED}/${TOTAL} passed, ${FAILED} failed`);
    console.log('═══════════════════════════════════════');

    if (SHOW_OVERLAY) {
        console.log('\n⏱️  Browser closes in 10 seconds…');
        await PAGE.waitForTimeout(10000);
    }

    await browser.close();
    process.exit(FAILED > 0 ? 1 : 0);
}

run().catch((err) => {
    console.error('❌ Test error:', err);
    process.exit(1);
});