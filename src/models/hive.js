const db = require('../db');
const utils = require('../utils');
const logger = utils.logger.get('models:hive');
const { parseJSON } = utils.jsonParse;
const { insertWithReusedId } = utils.idReuse;

let _hiveColumnsChecked = false;
let _hiveHasOwnerColumn = false;
let _hiveHasUserIdColumn = false;
let _hiveHasTypeColumn = false;
let _hiveHasHiveTypeColumn = false;
let _hiveHasGuildIdColumn = false;

async function ensureHiveColumns() {
  if (_hiveColumnsChecked) return;
  try {
    const table = 'hives';
    _hiveHasOwnerColumn = await db.knex.schema.hasColumn(table, 'owner_discord_id');
    _hiveHasUserIdColumn = await db.knex.schema.hasColumn(table, 'user_id');
    _hiveHasTypeColumn = await db.knex.schema.hasColumn(table, 'type');
    _hiveHasHiveTypeColumn = await db.knex.schema.hasColumn(table, 'hive_type');
    _hiveHasGuildIdColumn = await db.knex.schema.hasColumn(table, 'guild_id');
  } catch (err) {
    logger.warn('Failed checking hive table columns, assuming legacy names', { error: err && (err.stack || err) });
    _hiveHasOwnerColumn = false;
    _hiveHasUserIdColumn = true;
    _hiveHasTypeColumn = false;
    _hiveHasHiveTypeColumn = true;
    _hiveHasGuildIdColumn = false;
  }
  _hiveColumnsChecked = true;
}

async function createHive(ownerDiscordId, guildId = null, type = 'default', initialData = {}) {
  try {
    await ensureHiveColumns();
    const payload = {
      name: initialData.name || 'My Hive',
      queen_xeno_id: initialData.queen_xeno_id || null,
      capacity: initialData.capacity || 5,
      jelly_production_per_hour: initialData.jelly_production_per_hour || 0,
      data: initialData.data ? JSON.stringify(initialData.data) : null
    };
    if (_hiveHasGuildIdColumn) payload.guild_id = guildId;
    if (_hiveHasUserIdColumn) payload.user_id = String(ownerDiscordId);
    if (_hiveHasOwnerColumn) payload.owner_discord_id = String(ownerDiscordId);
    if (_hiveHasHiveTypeColumn) payload.hive_type = type;
    if (_hiveHasTypeColumn) payload.type = type;
    const id = await insertWithReusedId('hives', payload);
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

async function getHiveByOwner(ownerDiscordId, guildId = null) {
  try {
    await ensureHiveColumns();
    let row = null;
    const whereClause = {};
    if (_hiveHasGuildIdColumn && guildId) whereClause.guild_id = guildId;
    
    if (_hiveHasUserIdColumn) {
      whereClause.user_id = String(ownerDiscordId);
      row = await db.knex('hives').where(whereClause).first();
    }
    if (!row && _hiveHasOwnerColumn) {
      delete whereClause.user_id;
      whereClause.owner_discord_id = String(ownerDiscordId);
      row = await db.knex('hives').where(whereClause).first();
    }
    if (!row && !_hiveHasUserIdColumn && !_hiveHasOwnerColumn) {
      whereClause.user_id = String(ownerDiscordId);
      try { row = await db.knex('hives').where(whereClause).first(); } catch (_) { /* ignore */ void 0; }
      if (!row) {
        delete whereClause.user_id;
        whereClause.owner_discord_id = String(ownerDiscordId);
        try { row = await db.knex('hives').where(whereClause).first(); } catch (_) { /* ignore */ void 0; }
      }
    }
    if (!row) return null;
    return getHiveById(row.id);
  } catch (err) {
    logger.error('Failed fetching hive by owner', { ownerDiscordId, guildId, error: err && (err.stack || err) });
    throw err;
  }
}

async function getHivesByGuild(guildId) {
  try {
    await ensureHiveColumns();
    if (!_hiveHasGuildIdColumn) return [];
    const rows = await db.knex('hives').where({ guild_id: guildId }).select('*');
    return Promise.all(rows.map(r => (async () => {
      const parsed = parseJSON(r.data, null);
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
    await ensureHiveColumns();
    const payload = {};
    if (_hiveHasGuildIdColumn && 'guild_id' in changes) payload.guild_id = changes.guild_id;
    if ('type' in changes) {
      if (_hiveHasTypeColumn) payload.type = changes.type;
      if (_hiveHasHiveTypeColumn) payload.hive_type = changes.type;
    }
    if ('hive_type' in changes) {
      if (_hiveHasTypeColumn) payload.type = changes.hive_type;
      if (_hiveHasHiveTypeColumn) payload.hive_type = changes.hive_type;
    }
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
    // Unassign any xenomorphs that belonged to this hive first
    try {
      await db.knex('xenomorphs').where({ hive_id: id }).update({ hive_id: null, updated_at: db.knex.fn.now() });
    } catch (e) {
      logger.warn('Failed unassigning xenomorphs for deleted hive', { id, error: e && (e.stack || e) });
    }

    // Remove any module and milestone progress tied to this hive
    try {
      await db.knex('hive_modules').where({ hive_id: id }).del();
    } catch (e) {
      logger.warn('Failed deleting hive modules for deleted hive', { id, error: e && (e.stack || e) });
    }
    try {
      await db.knex('hive_milestones').where({ hive_id: id }).del();
    } catch (e) {
      logger.warn('Failed deleting hive milestones for deleted hive', { id, error: e && (e.stack || e) });
    }

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
    await ensureHiveColumns();
    let deleted = 0;
    let hiveRows = [];
    if (_hiveHasOwnerColumn) {
      hiveRows = await db.knex('hives').where({ owner_discord_id: String(ownerDiscordId) }).select('id');
    } else if (_hiveHasUserIdColumn) {
      hiveRows = await db.knex('hives').where({ user_id: String(ownerDiscordId) }).select('id');
    }
    const hiveIds = hiveRows.map(r => r.id).filter(Boolean);
    if (hiveIds.length > 0) {
      try {
        await db.knex('xenomorphs').whereIn('hive_id', hiveIds).update({ hive_id: null, updated_at: db.knex.fn.now() });
      } catch (e) {
        logger.warn('Failed unassigning xenomorphs for deleted owner hives', { ownerDiscordId, hiveIds, error: e && (e.stack || e) });
      }

      try {
        await db.knex('hive_modules').whereIn('hive_id', hiveIds).del();
      } catch (e) {
        logger.warn('Failed deleting hive modules for owner deleted hives', { ownerDiscordId, hiveIds, error: e && (e.stack || e) });
      }

      try {
        await db.knex('hive_milestones').whereIn('hive_id', hiveIds).del();
      } catch (e) {
        logger.warn('Failed deleting hive milestones for owner deleted hives', { ownerDiscordId, hiveIds, error: e && (e.stack || e) });
      }
    }
    if (_hiveHasOwnerColumn) {
      deleted = await db.knex('hives').where({ owner_discord_id: String(ownerDiscordId) }).del();
    } else if (_hiveHasUserIdColumn) {
      deleted = await db.knex('hives').where({ user_id: String(ownerDiscordId) }).del();
    }
    logger.info('Deleted hive by owner', { ownerDiscordId, deleted });
    return deleted > 0;
  } catch (err) {
    logger.error('Failed deleting hive by owner', { ownerDiscordId, error: err && (err.stack || err) });
    throw err;
  }
}

// Backwards-compatible helpers used elsewhere in the codebase
async function createHiveForUser(userId, guildId, opts = {}) {
  return createHive(String(userId), guildId, opts.hive_type || opts.type || 'default', opts);
}

async function getHiveByUser(userId, guildId = null) {
  return getHiveByOwner(String(userId), guildId);
}

async function upsertHive(userId, guildId, changes = {}) {
  await ensureHiveColumns();
  const whereCol = _hiveHasOwnerColumn ? 'owner_discord_id' : (_hiveHasUserIdColumn ? 'user_id' : 'owner_discord_id');
  const whereClause = { [whereCol]: String(userId) };
  if (_hiveHasGuildIdColumn && guildId) whereClause.guild_id = guildId;
  const existing = await db.knex('hives').where(whereClause).first();
  const payload = {};
  if ('name' in changes) payload.name = changes.name;
  if ('hive_type' in changes) {
    if (_hiveHasTypeColumn) payload.type = changes.hive_type;
    if (_hiveHasHiveTypeColumn) payload.hive_type = changes.hive_type;
  }
  if ('type' in changes) {
    if (_hiveHasTypeColumn) payload.type = changes.type;
    if (_hiveHasHiveTypeColumn) payload.hive_type = changes.type;
  }
  if ('capacity' in changes) payload.capacity = changes.capacity;
  if ('queen_xeno_id' in changes) payload.queen_xeno_id = changes.queen_xeno_id;
  if ('jelly_production_per_hour' in changes) payload.jelly_production_per_hour = changes.jelly_production_per_hour;
  if ('data' in changes) payload.data = JSON.stringify(changes.data);
  if (existing) {
    await db.knex('hives').where(whereClause).update(Object.assign(payload, { updated_at: db.knex.fn.now() }));
    return getHiveByUser(userId, guildId);
  }
  // create new
  return createHiveForUser(userId, guildId, changes);
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
