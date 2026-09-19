// server-modules/state.js
/**
 * @file server-modules/state.js
 * Process-wide singleton holding the active DeepSeek client and scheduler.
 *
 * The module exposes a minimal set/get API rather than the underlying
 * variables, so that the client can be swapped (for example, after
 * re-registration) without touching the modules that consume it.
 *
 * The scheduler is a placeholder for future use and is currently always
 * null; it is kept in the module signature so that historical consumers
 * continue to work.
 */

let globalClient = null;
let globalScheduler = null;

/**
 * Store the active client and scheduler.
 *
 * @param {object|null} client    - DeepSeekClient instance, or null to clear.
 * @param {object|null} scheduler - Optional scheduler instance.
 */
function setClientAndScheduler(client, scheduler) {
    globalClient = client;
    globalScheduler = scheduler;
}

/**
 * Get the active DeepSeek client, or null if none has been registered yet.
 *
 * @returns {object|null} The current client instance.
 */
function getClient() {
    return globalClient;
}

/**
 * Get the active scheduler, or null if none has been set.
 *
 * @returns {object|null} The current scheduler instance.
 */
function getScheduler() {
    return globalScheduler;
}

/**
 * Check whether a client has been registered and initialized.
 *
 * @returns {boolean} true if a client is available.
 */
function isReady() {
    return globalClient !== null;
}

module.exports = {
    setClientAndScheduler,
    getClient,
    getScheduler,
    isReady,
};