// src/utils/processCleanup.ts
/**
 * @file src/utils/processCleanup.ts
 * Cleanup of orphaned processes left behind by unclean shutdowns.
 *
 * Two independent problems are solved here:
 *
 *   1. Orphaned API server on our port. If a previous `npm start`
 *      was killed (Ctrl+Z, kill -9 of the parent, terminal
 *      closed), the node process may still hold port 3000 (or the
 *      agent's port). A fresh start fails with EADDRINUSE.
 *
 *   2. Zombie Chrome on the CDP port. If Chrome crashed or hung
 *      but its process is still attached to port 9222, CDP
 *      /json/version does not respond and spawn() fails with
 *      EADDRINUSE.
 *
 * Both are handled by killing the holder of the port, but only
 * when we can prove it is ours:
 *
 *   - The API server identifies itself by DEEPSEEK_API_KEY_PATH.
 *     Two agents in the same project have different key files, so
 *     they never kill each other. A completely unrelated node app
 *     on the same port has a different key path (or no key path
 *     at all) and is refused.
 *
 *   - Chrome is identified by port occupancy alone. If the port
 *     answers /json/version, it is NOT killed (it is reused for
 *     tab reuse). Only when port is bound but unresponsive is the
 *     holder killed — that is a zombie by definition.
 *
 * Platform support: /proc-based on Linux, lsof-based on macOS.
 * Windows is not supported (returns empty list, no cleanup).
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Return PIDs of processes listening on the given TCP port.
 * Empty array if none, or if the platform is unsupported.
 */
export function findPidsOnPort(port: number): number[] {
    const platform = os.platform();

    if (platform === 'linux') {
        const r = spawnSync('ss', ['-tlnp', `sport = :${port}`], {
            encoding: 'utf8',
        });
        if (r.status !== 0) return [];
        const pids = new Set<number>();
        for (const m of (r.stdout || '').matchAll(/pid=(\d+)/g)) {
            pids.add(parseInt(m[1], 10));
        }
        return [...pids];
    }

    if (platform === 'darwin') {
        const r = spawnSync('lsof', ['-t', '-i', `:${port}`, '-sTCP:LISTEN'], {
            encoding: 'utf8',
        });
        if (r.status !== 0) return [];
        return (r.stdout || '')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(p => parseInt(p, 10));
    }

    return [];
}

function getMyApiKeyPath(): string {
    return path.resolve(process.env.DEEPSEEK_API_KEY_PATH || './.api-key');
}

function readProcEnv(pid: number): Record<string, string> | null {
    if (os.platform() !== 'linux') return null;
    try {
        const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
        const result: Record<string, string> = {};
        for (const entry of env.split('\0')) {
            const eq = entry.indexOf('=');
            if (eq > 0) result[entry.slice(0, eq)] = entry.slice(eq + 1);
        }
        return result;
    } catch {
        return null;
    }
}

function readProcCwd(pid: number): string | null {
    if (os.platform() !== 'linux') return null;
    try {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
        return null;
    }
}

/**
 * Identify whether a process is an instance of our API server.
 *
 * Two independent checks:
 *
 *   1. Command line: argv[0] is node (or nodejs), argv[1] ends
 *      with "server.js". Rejects python, bash, and any other
 *      interpreter immediately — that alone fixes the
 *      python-on-4000 case.
 *
 *   2. Working directory: cwd equals ours, or one is a
 *      subdirectory of the other. Handles the multi-agent case
 *      where the API script lives at <repo>/server.js and the
 *      agent runs from <repo>/agents/agent-N/. Also rejects a
 *      "server.js" from a different project running on the same
 *      port by coincidence.
 *
 * The DEEPSEEK_API_KEY_PATH env check that this replaces was
 * unreliable: the API itself does not export it (falls back to
 * a default at read time), so /proc/<pid>/environ did not
 * contain it for our own processes either. We used to match
 * ANY process whose cwd resolved to our repo — including
 * `python3 -m http.server`.
 */
function isOurServer(pid: number, myCwd: string): boolean {
    if (os.platform() !== 'linux') return false;
    try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const argv = cmdline.split('\0').filter(Boolean);
        if (argv.length < 2) return false;

        const interp = path.basename(argv[0]);
        if (interp !== 'node' && interp !== 'nodejs') return false;
        if (!argv[1].endsWith('server.js')) return false;

        const cwd = readProcCwd(pid);
        if (!cwd) return false;
        if (cwd === myCwd) return true;
        if (cwd.startsWith(myCwd + path.sep)) return true;
        if (myCwd.startsWith(cwd + path.sep)) return true;
        return false;
    } catch {
        return false;
    }
}

function waitForPortFree(port: number, timeoutMs: number): boolean {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (findPidsOnPort(port).length === 0) return true;
        spawnSync('sleep', ['0.1']);
    }
    return false;
}

/**
 * Kill any orphaned instance of THIS server on the given port.
 * Called at startup, before app.listen() binds the port.
 *
 * Strategy:
 *   - Find all PIDs listening on the port.
 *   - Filter to those whose DEEPSEEK_API_KEY_PATH matches ours.
 *   - If any OTHER process (different key path) is on the port,
 *     refuse — do not kill foreign processes.
 *   - Send SIGTERM to our orphans; wait up to 3s; SIGKILL if
 *     still alive; wait up to 2s more.
 *
 * Called synchronously because server.js cannot proceed to
 * app.listen until the port is free.
 */
export function killOrphanedServerSync(
    port: number,
): { ok: boolean; reason?: string } {
    const pids = findPidsOnPort(port);
    if (pids.length === 0) return { ok: true };

    const myCwd = process.cwd();
    const ours: number[] = [];
    const theirs: number[] = [];

    for (const pid of pids) {
        if (pid === process.pid) continue;
        if (isOurServer(pid, myCwd)) {
            ours.push(pid);
        } else {
            theirs.push(pid);
        }
    }

    if (theirs.length > 0) {
        return {
            ok: false,
            reason:
                `Port ${port} is held by a process that does not belong ` +
                `to this API (PIDs: ${theirs.join(', ')}). Refusing to kill. ` +
                `Stop it manually or change PORT.`,
        };
    }

    for (const pid of ours) {
        console.log(`🧹 Killing orphaned API on port ${port} (PID ${pid})`);
        // SIGKILL, not SIGTERM. An orphaned process must not have
        // a chance to run its shutdown handler: close() would call
        // stopChromeCdp() and kill the Chrome we need for tab reuse.
        // The orphan has already failed to shut down cleanly once
        // (that is why it is an orphan); we do not give it a second
        // chance.
        try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }

    if (!waitForPortFree(port, 3000)) {
        return {
            ok: false,
            reason: `Port ${port} is still bound after SIGKILL. ` +
                    `Check with: ss -tlnp | grep ${port}`,
        };
    }

    return { ok: true };
}

/**
 * Kill the holder of the CDP port when it is bound but does not
 * answer /json/version. That combination is a zombie: Chrome
 * crashed or hung but its socket is still bound.
 *
 * Caller must already have verified that /json/version does NOT
 * respond. If it responds, the Chrome is healthy and MUST NOT be
 * killed (tab reuse depends on it).
 */
export async function killZombieChrome(port: number): Promise<void> {
    const pids = findPidsOnPort(port);
    if (pids.length === 0) return;

    for (const pid of pids) {
        console.log(`🧹 Killing zombie Chrome on port ${port} (PID ${pid})`);
        try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    }

    for (let i = 0; i < 20; i++) {
        if (findPidsOnPort(port).length === 0) return;
        await new Promise(r => setTimeout(r, 100));
    }

    for (const pid of findPidsOnPort(port)) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }
    for (let i = 0; i < 20; i++) {
        if (findPidsOnPort(port).length === 0) return;
        await new Promise(r => setTimeout(r, 100));
    }
}