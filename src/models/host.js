const db = require('../db');
const logger = require('../utils/logger').get('models:host');

async function addHostForUser(ownerId, hostType, data = {}) {
  const payload = {
    owner_id: String(ownerId),
    host_type: String(hostType),
    found_at: Date.now(),
    data: Object.keys(data).length ? JSON.stringify(data) : null
  };
  try {
    const inserted = await db.knex('hosts').insert(payload);
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    const row = await db.knex('hosts').where({ id }).first();
    return row;
  } catch (e) {
    logger.warn('Failed adding host to DB', { error: e && e.message });
    throw e;
  }
}

async function listHostsByOwner(ownerId) {
  try {
    const rows = await db.knex('hosts').where({ owner_id: String(ownerId) }).orderBy('id', 'asc');
    return rows.map(r => ({ ...r, data: r.data ? (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) : {} }));
  } catch (e) {
    logger.warn('Failed listing hosts from DB', { error: e && e.message });
    return [];
  }
}

async function deleteHostsByOwner(ownerId) {
  try {
    await db.knex('hosts').where({ owner_id: String(ownerId) }).del();
    return true;
  } catch (e) {
    logger.warn('Failed deleting hosts for owner', { error: e && e.message });
    throw e;
  }
}

async function getHostById(id) {
  try {
    const row = await db.knex('hosts').where({ id: Number(id) }).first();
    if (!row) return null;
    return { ...row, data: row.data ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {} };
  } catch (e) {
    logger.warn('Failed getting host by id', { error: e && e.message });
    return null;
  }
}

async function removeHostById(id) {
  try {
    const deleted = await db.knex('hosts').where({ id: Number(id) }).del();
    return deleted > 0;
  } catch (e) {
    logger.warn('Failed removing host by id', { error: e && e.message });
    throw e;
  }
}

async function deleteHostsById(ids) {
  try {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const deleted = await db.knex('hosts').whereIn('id', ids.map(Number)).del();
    return deleted;
  } catch (e) {
    logger.warn('Failed deleting multiple hosts by id', { error: e && e.message });
    throw e;
  }
}

module.exports = { addHostForUser, listHostsByOwner, deleteHostsByOwner, getHostById, removeHostById, deleteHostsById };
