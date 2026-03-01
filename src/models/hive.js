const db = require('../db');
const logger = require('../utils/logger').get('models:hive');

async function createHive(ownerDiscordId, guildId = null, type = 'default', initialData = {}) {
  try {
    const payload = {
      // support programmatic migration schema (user_id / hive_type) and newer owner_discord_id/type schema
      user_id: String(ownerDiscordId),
      owner_discord_id: String(ownerDiscordId),
      guild_id: guildId,
      name: initialData.name || 'My Hive',
      hive_type: type,
      type: type,
      queen_xeno_id: initialData.queen_xeno_id || null,
      capacity: initialData.capacity || 5,
      jelly_production_per_hour: initialData.jelly_production_per_hour || 0,
      data: initialData.data ? JSON.stringify(initialData.data) : null
    };
    const inserted = await db.knex('hives').insert(payload);
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    logger.info('Created hive', { ownerDiscordId, id, guildId, type });
    return getHiveById(id);
  } catch (err) {
    logger.error('Failed creating hive', { ownerDiscordId, guildId, type, error: err && (err.stack || err) });
    throw err;
  }
}

async function getHiveById(id) {
  try {
    const row = await db.knex('hives').where({ id }).first();
    if (!row) return null;
    let data = null;
    try { data = row.data ? JSON.parse(row.data) : null; } catch (e) { logger.warn('Failed parsing hive data JSON', { id, error: e && (e.stack || e) }); }
    return {
      id: row.id,
      owner_discord_id: row.owner_discord_id || row.user_id,
      user_id: row.user_id || row.owner_discord_id,
      guild_id: row.guild_id,
      name: row.name,
      type: row.type || row.hive_type,
      hive_type: row.hive_type || row.type,
      queen_xeno_id: row.queen_xeno_id,
      capacity: row.capacity,
      jelly_production_per_hour: row.jelly_production_per_hour,
      data,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  } catch (err) {
    logger.error('Failed fetching hive by id', { id, error: err && (err.stack || err) });
    throw err;
  }
}

async function getHiveByOwner(ownerDiscordId) {
  try {
    // try both possible column names created by different migration schemes
    let row = await db.knex('hives').where({ user_id: String(ownerDiscordId) }).first();
    if (!row) row = await db.knex('hives').where({ owner_discord_id: String(ownerDiscordId) }).first();
    if (!row) return null;
    return getHiveById(row.id);
  } catch (err) {
    logger.error('Failed fetching hive by owner', { ownerDiscordId, error: err && (err.stack || err) });
    throw err;
  }
}

async function getHivesByGuild(guildId) {
  try {
    const rows = await db.knex('hives').where({ guild_id: guildId }).select('*');
    return Promise.all(rows.map(r => (async () => {
      const parsed = r.data ? JSON.parse(r.data) : null;
      return {
        id: r.id,
        owner_discord_id: r.owner_discord_id,
        guild_id: r.guild_id,
        name: r.name,
        type: r.type,
        hive_type: r.type,
        queen_xeno_id: r.queen_xeno_id,
        capacity: r.capacity,
        jelly_production_per_hour: r.jelly_production_per_hour,
        data: parsed,
        created_at: r.created_at,
        updated_at: r.updated_at
      };
    })()));
  } catch (err) {
    logger.error('Failed fetching hives by guild', { guildId, error: err && (err.stack || err) });
    throw err;
  }
}

async function updateHiveById(id, changes = {}) {
  try {
    const payload = {};
    if ('guild_id' in changes) payload.guild_id = changes.guild_id;
    if ('type' in changes) payload.type = changes.type;
    if ('name' in changes) payload.name = changes.name;
    if ('capacity' in changes) payload.capacity = changes.capacity;
    if ('queen_xeno_id' in changes) payload.queen_xeno_id = changes.queen_xeno_id;
    if ('jelly_production_per_hour' in changes) payload.jelly_production_per_hour = changes.jelly_production_per_hour;
    if ('data' in changes) payload.data = JSON.stringify(changes.data);
    if (Object.keys(payload).length === 0) return getHiveById(id);
    await db.knex('hives').where({ id }).update({ ...payload, updated_at: db.knex.fn.now() });
    logger.info('Updated hive', { id, changes });
    return getHiveById(id);
  } catch (err) {
    logger.error('Failed updating hive', { id, changes, error: err && (err.stack || err) });
    throw err;
  }
}

async function deleteHiveById(id) {
  try {
    const deleted = await db.knex('hives').where({ id }).del();
    logger.info('Deleted hive', { id, deleted });
    return deleted > 0;
  } catch (err) {
    logger.error('Failed deleting hive by id', { id, error: err && (err.stack || err) });
    throw err;
  }
}

async function deleteHiveByOwner(ownerDiscordId) {
  try {
    const deleted = await db.knex('hives').where({ owner_discord_id: String(ownerDiscordId) }).del();
    logger.info('Deleted hive by owner', { ownerDiscordId, deleted });
    return deleted > 0;
  } catch (err) {
    logger.error('Failed deleting hive by owner', { ownerDiscordId, error: err && (err.stack || err) });
    throw err;
  }
}

// Backwards-compatible helpers used elsewhere in the codebase
async function createHiveForUser(userId, opts = {}) {
  return createHive(String(userId), null, opts.hive_type || opts.type || 'default', opts);
}

async function getHiveByUser(userId) {
  return getHiveByOwner(String(userId));
}

async function upsertHive(userId, changes = {}) {
  const existing = await db.knex('hives').where({ owner_discord_id: String(userId) }).first();
  const payload = {};
  if ('name' in changes) payload.name = changes.name;
  if ('hive_type' in changes) payload.type = changes.hive_type;
  if ('capacity' in changes) payload.capacity = changes.capacity;
  if ('queen_xeno_id' in changes) payload.queen_xeno_id = changes.queen_xeno_id;
  if ('jelly_production_per_hour' in changes) payload.jelly_production_per_hour = changes.jelly_production_per_hour;
  if ('data' in changes) payload.data = JSON.stringify(changes.data);
  if (existing) {
    await db.knex('hives').where({ owner_discord_id: String(userId) }).update(Object.assign(payload, { updated_at: db.knex.fn.now() }));
    return getHiveByUser(userId);
  }
  // create new
  return createHiveForUser(userId, changes);
}

module.exports = {
  createHive,
  getHiveById,
  getHiveByOwner,
  getHivesByGuild,
  updateHiveById,
  deleteHiveById,
  deleteHiveByOwner,
  // legacy helpers
  createHiveForUser,
  getHiveByUser,
  upsertHive
};
