const db = require('../db');
const { parseJSON } = require('../utils/jsonParse');
const { insertWithReusedId } = require('../utils/idReuse');

async function getById(id) {
  const row = await db.knex('xenomorphs').where({ id: Number(id) }).first();
  if (!row) return null;
  row.stats = parseJSON(row.stats, {}, `xeno:${id}.stats`);
  row.data = parseJSON(row.data, {}, `xeno:${id}.data`);
  return row;
}

async function listByOwner(ownerId) {
  const rows = await db.knex('xenomorphs').where({ owner_id: String(ownerId) }).orderBy('id', 'asc');
  return rows.map(r => ({ ...r, stats: parseJSON(r.stats, {}), data: parseJSON(r.data, {}) }));
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
  const id = await insertWithReusedId('xenomorphs', payload);
  return getXenoById(id);
}

async function getXenoById(id) {
  const row = await db.knex('xenomorphs').where({ id }).first();
  if (!row) return null;
  row.stats = parseJSON(row.stats, {}, `xeno:${id}.stats`);
  row.data = parseJSON(row.data, {}, `xeno:${id}.data`);
  return row;
}

async function getXenosByOwner(ownerId) {
  const rows = await db.knex('xenomorphs').where({ owner_id: String(ownerId) }).orderBy('id', 'asc');
  return rows.map(r => ({
    ...r,
    stats: parseJSON(r.stats, {}),
    data: parseJSON(r.data, {})
  }));
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
