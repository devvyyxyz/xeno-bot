const db = require('../db');
const { parseJSON } = require('../utils/jsonParse');
const logger = require('../utils/logger').get('models:host');

async function addHostForUser(ownerId, hostType, data = {}) {
  const basePayload = {
    owner_id: String(ownerId),
    host_type: String(hostType),
    found_at: Date.now(),
    data: Object.keys(data).length ? JSON.stringify(data) : null
  };
  // If the hosts table has an explicit `guild_id` column, include it; otherwise rely on JSON `data`.
  let payload = { ...basePayload };
  try {
    const hasGuildCol = await db.knex.schema.hasColumn('hosts', 'guild_id');
    const gid = data && (data.guild_id || data.guildId || data.guild) ? String(data.guild_id || data.guildId || data.guild) : null;
    if (hasGuildCol) {
      // Enforce guild association when DB schema supports it
      if (!gid) throw new Error('guild_id required when creating hosts');
      payload = { ...basePayload, guild_id: gid };
    } else {
      payload = basePayload;
    }
  } catch (e) {
    // If schema check fails for some reason, fall back to base payload and let insert proceed
    logger.warn('Failed checking hosts.guild_id column existence or missing guild', { error: e && e.message });
    // If error was missing guild_id, rethrow to let caller handle it
    if (e && String(e.message).includes('guild_id required')) throw e;
    payload = basePayload;
  }
  try {
    const res = await db.knex('hosts').insert(payload);
    const id = Array.isArray(res) ? res[0] : res;
    const row = await db.knex('hosts').where({ id }).first();
    return row;
  } catch (e) {
    logger.warn('Failed adding host to DB', { error: e && e.message });
    throw e;
  }
}

async function listHostsByOwner(ownerId, guildId = null) {
  // Return only hosts that belong to the specified guild. If no guildId provided, return empty list.
  if (!guildId) return [];
  try {
    // If the hosts table has a `guild_id` column, use it in the query to reduce rows returned.
    const hasGuildCol = await db.knex.schema.hasColumn('hosts', 'guild_id');
    let rows;
    if (hasGuildCol) {
      rows = await db.knex('hosts').where({ owner_id: String(ownerId) }).andWhere(function () {
        this.where('guild_id', String(guildId)).orWhereNull('guild_id');
      }).orderBy('id', 'asc');
    } else {
      // Legacy schema: fetch by owner and filter JSON `data` in JS
      rows = await db.knex('hosts').where({ owner_id: String(ownerId) }).orderBy('id', 'asc');
    }
    const parsed = rows.map(r => ({ ...r, data: parseJSON(r.data, {}) }));
    // Filter to only records that either have explicit guild_id matching, or whose JSON data contains a matching guild
    return parsed.filter(r => {
      if (r.guild_id) return String(r.guild_id) === String(guildId);
      const d = r.data || {};
      const hostGuild = d && (d.guild_id || d.guildId || d.guild) ? String(d.guild_id || d.guildId || d.guild) : null;
      return hostGuild ? String(hostGuild) === String(guildId) : false;
    });
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

async function getHostById(id, guildId = null) {
  // If guildId is provided, enforce that the host belongs to that guild. If not provided, return null
  if (!guildId) return null;
  try {
    const row = await db.knex('hosts').where({ id: Number(id) }).first();
    if (!row) return null;
    const parsed = { ...row, data: parseJSON(row.data, {}) };
    if (parsed.guild_id && String(parsed.guild_id) === String(guildId)) return parsed;
    const d = parsed.data || {};
    const hostGuild = d && (d.guild_id || d.guildId || d.guild) ? String(d.guild_id || d.guildId || d.guild) : null;
    if (hostGuild && String(hostGuild) === String(guildId)) return parsed;
    return null;
  } catch (e) {
    logger.warn('Failed getting host by id', { error: e && e.message });
    return null;
  }
}

async function removeHostById(id, guildId = null) {
  try {
    // If guildId provided, verify host belongs to guild before deleting
    if (guildId) {
      const row = await db.knex('hosts').where({ id: Number(id) }).first();
      if (!row) return false;
      const pdata = parseJSON(row.data, {});
      const hostGuild = row.guild_id || (pdata && (pdata.guild_id || pdata.guildId || pdata.guild));
      if (!hostGuild || String(hostGuild) !== String(guildId)) return false;
    }
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
