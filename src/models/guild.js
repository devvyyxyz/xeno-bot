const db = require('../db');
const logger = require('../utils/logger').get('models:guild');
const cache = require('../utils/cache');

const CACHE_TTL_MS = Number(process.env.GUILD_CACHE_TTL_MS) || 30_000; // 30s default

async function getGuildConfig(guildId) {
  const cached = cache.get(`guild:${guildId}`);
  if (cached) return cached;

  const row = await db.knex('guild_settings').where({ guild_id: guildId }).first();
  if (!row) return null;
  try {
    const data = row.data ? JSON.parse(row.data) : null;
    return {
      id: row.id,
      guild_id: row.guild_id,
      channel_id: row.channel_id,
      spawn_min_seconds: row.spawn_min_seconds ?? null,
      spawn_max_seconds: row.spawn_max_seconds ?? null,
      egg_limit: row.egg_limit,
      data,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  } catch (err) {
    logger.error('Failed parsing guild config JSON', { guildId, error: err.stack || err });
    const result = { id: row.id, guild_id: row.guild_id };
    cache.set(`guild:${guildId}`, result, CACHE_TTL_MS);
    return result;
  }
}

async function upsertGuildConfig(guildId, changes = {}) {
  const existing = await db.knex('guild_settings').where({ guild_id: guildId }).first();
  const payload = {};
  if ('channel_id' in changes) payload.channel_id = changes.channel_id;
  // accept spawn seconds as either spawn_min_seconds/spawn_max_seconds or spawn_rate_minutes (legacy)
  if ('spawn_min_seconds' in changes) payload.spawn_min_seconds = changes.spawn_min_seconds;
  if ('spawn_max_seconds' in changes) payload.spawn_max_seconds = changes.spawn_max_seconds;
  if ('spawn_rate_minutes' in changes) {
    const secs = Number(changes.spawn_rate_minutes) * 60;
    payload.spawn_min_seconds = secs;
    payload.spawn_max_seconds = secs;
  }
  if ('egg_limit' in changes) payload.egg_limit = changes.egg_limit;
  if ('data' in changes) payload.data = JSON.stringify(changes.data);

  if (existing) {
    await db.knex('guild_settings').where({ guild_id: guildId }).update({ ...payload, updated_at: db.knex.fn.now() });
    logger.info('Updated guild config', { guildId, changes });
  } else {
    await db.knex('guild_settings').insert({ guild_id: guildId, ...payload });
    logger.info('Inserted guild config', { guildId, changes });
  }
  // invalidate cache and return fresh
  cache.del(`guild:${guildId}`);
  const fresh = await getGuildConfig(guildId);
  cache.set(`guild:${guildId}`, fresh, CACHE_TTL_MS);
  // If spawn settings changed, request spawnManager to reschedule (deferred until current eggs cleared)
  try {
    // require lazily to avoid initialization order issues
    const spawnManager = require('../spawnManager');
    if (spawnManager && typeof spawnManager.requestReschedule === 'function') {
      spawnManager.requestReschedule(guildId);
    }
  } catch (err) {
    logger.debug('spawnManager not available for reschedule', { error: err && (err.stack || err) });
  }
  return fresh;
}

module.exports = { getGuildConfig, upsertGuildConfig };
