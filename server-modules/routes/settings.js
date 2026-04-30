// server-modules/routes/settings.js
const { getClient, isReady } = require('../state');

async function getStatus(req, res) {
    if (!isReady()) {
        return res.status(503).json({ error: 'Client not ready' });
    }
    const client = getClient();
    try {
        const mode = await client.featureToggles.getCurrentMode();
        res.json({ success: true, mode });
    } catch (err) {
        console.error('Failed to get current mode:', err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = { getStatus };