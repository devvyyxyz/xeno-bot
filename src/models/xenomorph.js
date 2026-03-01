const db = require('../db');
const logger = require('../utils/logger').get('models:xenomorph');

async function getById(id) {
  const row = await db.knex('xenomorphs').where({ id: Number(id) }).first();
  if (!row) return null;
  try {
    row.stats = row.stats ? JSON.parse(row.stats) : {};
    row.data = row.data ? JSON.parse(row.data) : {};
  } catch (e) { logger.warn('Failed parsing xeno JSON', { id, error: e && e.message }); }
  return row;
}

async function listByOwner(ownerId) {
  const rows = await db.knex('xenomorphs').where({ owner_id: String(ownerId) }).orderBy('id', 'asc');
  return rows.map(r => ({ ...r, stats: r.stats ? JSON.parse(r.stats) : {}, data: r.data ? JSON.parse(r.data) : {} }));
}

async function createXeno(ownerId, opts = {}) {
  const payload = {
    owner_id: String(ownerId),
    hive_id: opts.hive_id || null,
    pathway: opts.pathway || 'standard',
    role: opts.role || 'egg',
    stage: opts.stage || 'egg',
    level: opts.level || 1,
    stats: opts.stats ? JSON.stringify(opts.stats) : null,
    data: opts.data ? JSON.stringify(opts.data) : null
  };
  const inserted = await db.knex('xenomorphs').insert(payload);
  const id = Array.isArray(inserted) ? inserted[0] : inserted;
  return getXenoById(id);
}

async function getXenoById(id) {
  const row = await db.knex('xenomorphs').where({ id }).first();
  if (!row) return null;
  try {
    row.stats = row.stats ? JSON.parse(row.stats) : {};
    row.data = row.data ? JSON.parse(row.data) : {};
  } catch (e) { logger.warn('Failed parsing xeno JSON', { id, error: e && e.message }); }
  return row;
}

async function getXenosByOwner(ownerId) {
  const rows = await db.knex('xenomorphs').where({ owner_id: String(ownerId) }).orderBy('id', 'asc');
  return rows.map(r => {
    try { r.stats = r.stats ? JSON.parse(r.stats) : {}; r.data = r.data ? JSON.parse(r.data) : {}; } catch (e) {}
    return r;
  });
}

async function deleteXenosByOwner(ownerId) {
  try {
    await db.knex('xenomorphs').where({ owner_id: String(ownerId) }).del();
    return true;
  } catch (e) {
    logger.warn('Failed deleting xenomorphs for owner', { error: e && e.message });
    throw e;
  }
}

module.exports = {
  // canonical names
  createXeno,
  getXenoById,
  getXenosByOwner,
  deleteXenosByOwner,
  // compatibility aliases used by existing commands
  getById,
  listByOwner
};
