const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger').get('models:host');

const HOSTS_FILE = path.join(__dirname, '..', '..', 'data', 'hosts.json');

async function _read() {
  try {
    const raw = await fs.readFile(HOSTS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    logger.warn('Failed reading hosts file', { error: e && e.message });
    return [];
  }
}

async function _write(rows) {
  try {
    await fs.writeFile(HOSTS_FILE, JSON.stringify(rows, null, 2), 'utf8');
    return true;
  } catch (e) {
    logger.warn('Failed writing hosts file', { error: e && e.message });
    throw e;
  }
}

async function addHostForUser(ownerId, hostType) {
  const rows = await _read();
  const id = Date.now();
  const host = { id, owner_discord_id: String(ownerId), host_type: hostType, created_at: new Date().toISOString() };
  rows.push(host);
  await _write(rows);
  return host;
}

async function listHostsByOwner(ownerId) {
  const rows = await _read();
  return rows.filter(r => String(r.owner_discord_id) === String(ownerId));
}

module.exports = { addHostForUser, listHostsByOwner };
