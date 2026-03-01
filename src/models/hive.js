const db = require('../db');
const logger = require('../utils/logger').get('models:hive');

async function createHiveForUser(userId, opts = {}) {
  const exists = await db.knex('hives').where({ user_id: String(userId) }).first();
  if (exists) return exists;
  const payload = {
    user_id: String(userId),
    name: opts.name || 'My Hive',
    hive_type: opts.hive_type || 'default',
    capacity: opts.capacity || 5,
    jelly_production_per_hour: opts.jelly_production_per_hour || 0,
    data: opts.data ? JSON.stringify(opts.data) : null
  };
  const inserted = await db.knex('hives').insert(payload);
  const id = Array.isArray(inserted) ? inserted[0] : inserted;
  logger.info('Created hive', { userId, id });
  return getHiveByUser(userId);
}

async function getHiveByUser(userId) {
  const row = await db.knex('hives').where({ user_id: String(userId) }).first();
  if (!row) return null;
  try {
    const data = row.data ? JSON.parse(row.data) : {};
    return Object.assign({}, row, { data });
  } catch (e) {
    logger.warn('Failed parsing hive data JSON', { userId, error: e && e.message });
    return row;
  }
}

async function upsertHive(userId, changes = {}) {
  const existing = await db.knex('hives').where({ user_id: String(userId) }).first();
  const payload = {};
  if ('name' in changes) payload.name = changes.name;
  if ('hive_type' in changes) payload.hive_type = changes.hive_type;
  if ('capacity' in changes) payload.capacity = changes.capacity;
  if ('queen_xeno_id' in changes) payload.queen_xeno_id = changes.queen_xeno_id;
  if ('jelly_production_per_hour' in changes) payload.jelly_production_per_hour = changes.jelly_production_per_hour;
  if ('data' in changes) payload.data = JSON.stringify(changes.data);
  if (existing) {
    await db.knex('hives').where({ user_id: String(userId) }).update(Object.assign(payload, { updated_at: db.knex.fn.now() }));
    return getHiveByUser(userId);
  }
  // create new
  return createHiveForUser(userId, changes);
}

module.exports = { createHiveForUser, getHiveByUser, upsertHive };
