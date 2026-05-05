// server-modules/state.js
let globalClient = null;
let globalScheduler = null;

function setClientAndScheduler(client, scheduler) {
    globalClient = client;
    globalScheduler = scheduler;
}

function getClient() {
    return globalClient;
}

function getScheduler() {
    return globalScheduler;
}

function isReady() {
    return globalClient !== null;
}

module.exports = {
    setClientAndScheduler,
    getClient,
    getScheduler,
    isReady
};