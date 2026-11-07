// src/browser/chromeCdp.ts
/**
 * @file src/browser/chromeCdp.ts
 * Manages the lifecycle of a Chrome instance that Playwright connects
 * to via CDP.
 *
 * Two scenarios:
 *
 *   - External Chrome. Someone else (the user, or a VS Code
 *     extension like Pingis) has already started Chrome with
 *     --remote-debugging-port. We detect it via HTTP and connect
 *     without touching its lifecycle. On API shutdown, we do not
 *     close it.
 *
 *   - Autolaunch. Nobody started Chrome. We launch it ourselves,
 *     with a dedicated profile directory, and — if configured —
 *     close it on shutdown.
 *
 * Detection is a simple HTTP GET to /json/version. If it answers,
 * a Chrome with CDP is already there; we use it and never claim
 * ownership of its process.
 *
 * Profile handling on autolaunch:
 *   - If DEEPSEEK_CDP_PROFILE_DIR exists with a Default/ subdirectory,
 *     use it.
 *   - Otherwise, if DEEPSEEK_CDP_COPY_DEFAULT_PROFILE is true (default),
 *     copy the user's ~/.config/google-chrome once. This gives the
 *     fresh Chrome all the existing cookies and history — which is
 *     exactly what defeats Cloudflare's fingerprint check.
 *   - Otherwise, create an empty profile directory. Chrome will show
 *     the login page on first request; the user must log in manually.
 *
 * The PID of the launched Chrome is remembered so that stop() can
 * close exactly the process we started, and nothing else.
 */

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

let launchedChromePid: number | null = null;

export interface CdpConfig {
    port: number;
    profileDir: string;
    chromePath: string;
    autolaunch: boolean;
    autoclose: boolean;
    copyFromDefault: boolean;
    extraArgs: string[];
}

/**
 * Expand a leading "~" to the user's home directory, then resolve
 * to an absolute path. path.resolve alone does NOT expand "~" — it
 * treats the tilde as a literal directory name, producing paths like
 * <cwd>/~/.config/google-chrome-cdp.
 */
function expandHome(p: string): string {
    if (p === '~') return os.homedir();
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    return path.resolve(p);
}

export function getCdpConfig(): CdpConfig {
    return {
        port: parseInt(process.env.DEEPSEEK_CDP_PORT || '9222', 10),
        profileDir: process.env.DEEPSEEK_CDP_PROFILE_DIR
            ? expandHome(process.env.DEEPSEEK_CDP_PROFILE_DIR)
            : path.join(os.homedir(), '.config', 'google-chrome-cdp'),
        chromePath: process.env.DEEPSEEK_CHROME_PATH || 'google-chrome-stable',
        autolaunch: process.env.DEEPSEEK_CDP_AUTOLAUNCH !== 'false',
        autoclose: process.env.DEEPSEEK_CDP_AUTOCLOSE !== 'false',
        copyFromDefault: process.env.DEEPSEEK_CDP_COPY_DEFAULT_PROFILE !== 'false',
        extraArgs: (process.env.DEEPSEEK_CHROME_EXTRA_ARGS || '')
            .split(/\s+/).filter(Boolean),
    };
}

export function getCdpUrl(): string {
    const port = parseInt(process.env.DEEPSEEK_CDP_PORT || '9222', 10);
    return `http://127.0.0.1:${port}`;
}

async function isCdpResponding(url: string, timeoutMs = 1500): Promise<boolean> {
    try {
        const res = await fetch(`${url}/json/version`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function waitForCdp(url: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isCdpResponding(url)) return true;
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

function profileHasData(profileDir: string): boolean {
    return fs.existsSync(path.join(profileDir, 'Default'));
}

function copyProfileFromDefault(profileDir: string): void {
    const defaultProfile = path.join(os.homedir(), '.config', 'google-chrome');
    if (!fs.existsSync(defaultProfile)) {
        console.log(`ℹ️  No default Chrome profile at ${defaultProfile}; starting fresh`);
        return;
    }
    console.log(`→ Copying Chrome profile (one-time setup, may take ~30s)`);
    console.log(`  from: ${defaultProfile}`);
    console.log(`  to:   ${profileDir}`);
    // Use src/. and dst/ so that contents go INTO profileDir rather
    // than profileDir/google-chrome/. The destination already exists
    // (we mkdir'd it before calling this), and `cp -a src dst` with an
    // existing dst would create dst/src as a subdirectory.
    const result = spawnSync(
        'cp',
        ['-a', `${defaultProfile}/.`, `${profileDir}/`],
        { stdio: 'inherit' },
    );
    if (result.status !== 0) {
        console.warn(`⚠️  Profile copy failed, will start with empty profile`);
    }
}

/**
 * Locate the Cookies sqlite file in a Chrome profile.
 *
 * Chrome has moved this file over the years:
 *   - pre-96:  Default/Cookies
 *   - 96+:     Default/Network/Cookies
 *   - multi-profile: Profile N/Network/Cookies
 *
 * Search every profile directory we know of. Only one file is
 * expected to exist; we return the first match.
 */
function findCookiesPath(profileDir: string): string | null {
    const subdirs = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
    for (const sub of subdirs) {
        for (const tail of [['Network', 'Cookies'], ['Cookies']]) {
            const candidate = path.join(profileDir, sub, ...tail);
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * Sync auth-related files from the user's default Chrome profile
 * to the CDP profile, copying only when the source is newer.
 *
 * Without this, the CDP profile is a snapshot of the moment of
 * first copy. Google and DeepSeek rotate session tokens (every
 * ~30 minutes for OAuth, longer for cookies). The snapshot goes
 * stale, Cloudflare sees an invalid session, DeepSeek shows the
 * verify-account modal.
 *
 * Files synced (only if source is newer):
 *   - Cookies     (Google account session, DeepSeek session, cf_clearance)
 *   - Local State (encryption keys — mandatory, otherwise Chrome
 *                  cannot decrypt the copied Cookies)
 *   - Login Data  (Google credentials cache)
 *
 * Nothing else is copied: history, extensions, bookmarks stay in
 * the CDP profile as-is.
 */
function syncAuthFilesFromSource(targetProfileDir: string): void {
    const sourceProfile = path.join(os.homedir(), '.config', 'google-chrome');
    if (!fs.existsSync(sourceProfile)) return;

    const syncFile = (relPath: string): boolean => {
        const src = path.join(sourceProfile, relPath);
        const tgt = path.join(targetProfileDir, relPath);
        if (!fs.existsSync(src) || !fs.existsSync(tgt)) return false;
        const srcMtime = fs.statSync(src).mtimeMs;
        const tgtMtime = fs.statSync(tgt).mtimeMs;
        if (srcMtime <= tgtMtime) return false;
        fs.copyFileSync(src, tgt);
        return true;
    };

    // Cookies — find actual path (Network/Cookies on Chrome 120+)
    const srcCookies = findCookiesPath(sourceProfile);
    const tgtCookies = findCookiesPath(targetProfileDir);
    if (srcCookies && tgtCookies) {
        const srcMtime = fs.statSync(srcCookies).mtimeMs;
        const tgtMtime = fs.statSync(tgtCookies).mtimeMs;
        if (srcMtime > tgtMtime) {
            fs.copyFileSync(srcCookies, tgtCookies);
            for (const suffix of ['-wal', '-shm']) {
                const srcW = srcCookies + suffix;
                const tgtW = tgtCookies + suffix;
                if (fs.existsSync(srcW)) {
                    try {
                        fs.copyFileSync(srcW, tgtW);
                    } catch { /* locked by running Chrome; non-fatal */ }
                }
            }
            console.log(`→ Synced Cookies from source profile`);
        }
    }

    if (syncFile('Local State')) {
        console.log(`→ Synced Local State from source profile`);
    }
    if (syncFile(path.join('Default', 'Login Data'))) {
        // quiet — this one rarely matters, no log
    }
}

/**
 * Ensure a Chrome with CDP is reachable at the configured URL.
 * Launches one if needed and allowed. Returns true on success.
 *
 * Idempotent: a second call after a successful first call is a no-op
 * (the launched PID is still alive and CDP is responding).
 */
export async function ensureChromeCdp(): Promise<boolean> {
    const config = getCdpConfig();
    const cdpUrl = getCdpUrl();

    if (await isCdpResponding(cdpUrl)) {
        console.log(`✓ Chrome CDP already running at ${cdpUrl}`);
        return true;
    }

    // Port is bound but /json/version does not answer. That is a
    // zombie Chrome — crashed or hung while still owning the socket.
    // Kill it before we try to spawn a fresh one, otherwise spawn
    // fails with EADDRINUSE.
    const { findPidsOnPort, killZombieChrome } = await import('../utils/processCleanup.js');
    if (findPidsOnPort(config.port).length > 0) {
        console.log(`🧹 Port ${config.port} is bound but CDP is not responding; killing zombie`);
        await killZombieChrome(config.port);
    }

    if (!config.autolaunch) {
        console.error(
            `✗ Chrome CDP not running at ${cdpUrl}, and ` +
            `DEEPSEEK_CDP_AUTOLAUNCH is disabled`
        );
        return false;
    }

    // Prepare profile directory
    fs.mkdirSync(config.profileDir, { recursive: true });
    if (!profileHasData(config.profileDir)) {
        if (config.copyFromDefault) {
            copyProfileFromDefault(config.profileDir);
        } else {
            console.log(`ℹ️  Starting with empty profile at ${config.profileDir}`);
        }
    } else if (config.copyFromDefault) {
        // Profile already exists. Sync auth files (cookies, Local
        // State) from the user's main Chrome, but only when the
        // source is newer. Google and DeepSeek rotate tokens; without
        // this sync the profile goes stale after ~30 minutes and
        // Cloudflare blocks the login.
        syncAuthFilesFromSource(config.profileDir);
    }

    console.log(`→ Launching Chrome with CDP on port ${config.port}`);
    console.log(`  binary:  ${config.chromePath}`);
    console.log(`  profile: ${config.profileDir}`);

    const args = [
        `--remote-debugging-port=${config.port}`,
        '--remote-allow-origins=*',
        `--user-data-dir=${config.profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...config.extraArgs,
    ];

    const child = spawn(config.chromePath, args, {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    if (!child.pid) {
        console.error(`✗ Failed to spawn ${config.chromePath}`);
        return false;
    }
    launchedChromePid = child.pid;
    console.log(`✓ Chrome launched (PID ${child.pid})`);

    if (!(await waitForCdp(cdpUrl, 20000))) {
        console.error(
            `✗ Chrome did not open CDP port ${config.port} within 20s. ` +
            `Check ${config.chromePath} --version and that the binary is executable.`
        );
        return false;
    }

    console.log(`✓ Chrome CDP ready at ${cdpUrl}`);
    return true;
}

/**
 * Close the Chrome we launched (if any), respecting autoclose.
 *
 * If the Chrome was NOT launched by us (external Chrome, e.g. Pingis),
 * this is a no-op. We never kill a process we did not start.
 */
export function stopChromeCdp(): void {
    if (launchedChromePid === null) {
        return;  // external Chrome, not ours
    }

    const config = getCdpConfig();
    const pid = launchedChromePid;
    launchedChromePid = null;

    if (!config.autoclose) {
        console.log(
            `ℹ️  Leaving Chrome running (PID ${pid}). ` +
            `Set DEEPSEEK_CDP_AUTOCLOSE=true to close it on shutdown.`
        );
        return;
    }

    console.log(`→ Stopping Chrome (PID ${pid})`);
    try {
        // Negative PID = process group. Detached spawn put Chrome in
        // its own group; killing the group takes down renderers too.
        process.kill(-pid, 'SIGTERM');
    } catch {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
    }
}