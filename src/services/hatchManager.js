const db = require('../db');
const utils = require('../utils');
const logger = utils.logger.get('hatch');
const fallbackLogger = utils.fallbackLogger;
const models = require('../models');
const userModel = models.user;
const eggTypes = require('../../config/eggTypes.json');
void eggTypes;
const xenoModel = models.xenomorph;

function getGuildName(guildId) {
  try {
    if (!client) {
      logger.debug && logger.debug('getGuildName: client is null', { guildId });
      return `Guild-${guildId}`;
    }
    const guild = client.guilds.cache.get(guildId);
    if (guild && guild.name) {
      return guild.name;
    }
    const guildById = client.guilds.cache.get(String(guildId));
    if (guildById && guildById.name) {
      return guildById.name;
    }
    logger.debug && logger.debug('getGuildName: guild not in cache', { guildId, cacheSize: client.guilds.cache.size });
    return `Guild-${guildId}`;
  } catch (e) {
    logger.warn && logger.warn('getGuildName error', { guildId, error: e.message });
    return `Guild-${guildId}`;
  }
}

let timers = new Map();
let client = null;

async function init(botClient) {
  client = botClient || null;
  try {
    const rows = await db.knex('hatches').where({ collected: false }).select('*');
    for (const r of rows) {
      const now = Date.now();
      const finishes = Number(r.finishes_at) || now;
      if (finishes <= now) {
        continue;
      }
      const delay = finishes - now;
      scheduleTimer(r.id, delay);
      const guildName = getGuildName(r.guild_id);
      logger.debug(`Restored hatch timer (${guildName})`, { id: r.id, discord_id: r.discord_id, guild_id: r.guild_id, in_ms: delay });
    }
  } catch (e) {
    logger.error('Failed initializing hatch manager', { error: e && (e.stack || e) });
  }
  try {
    utils.systemMonitor.registerSystem('hatchManager', { name: 'Hatch Manager', shutdown: shutdown });
  } catch (e) { logger.warn('Failed registering hatchManager with systemMonitor', { error: e && (e.stack || e) }); }
}

function scheduleTimer(hatchId, delay) {
  if (timers.has(hatchId)) {
    clearTimeout(timers.get(hatchId));
  }
  const t = setTimeout(() => {
    timers.delete(hatchId);
    logger.info('Hatch finished timer fired', { hatchId });
  }, delay);
  timers.set(hatchId, t);
}

async function startHatch(discordId, guildId, eggTypeId, durationMs) {
  const user = await userModel.getUserByDiscordId(discordId);
  if (!user) throw new Error('User not found');
  const data = user.data || {};
  data.guilds = data.guilds || {};
  const g = data.guilds[guildId] = data.guilds[guildId] || { eggs: {}, items: {}, currency: {} };
  try {
    const now = Date.now();
    if (g && g.effects && g.effects.incubation_accelerator) {
      const eff = g.effects.incubation_accelerator;
      if (eff && (eff.expires_at || 0) > now) {
        const mul = (typeof eff.multiplier === 'number' && eff.multiplier > 0 && eff.multiplier <= 1) ? Number(eff.multiplier) : null;
        if (mul) {
          durationMs = Math.max(1, Math.floor(Number(durationMs || 60_000) * mul));
          try { delete g.effects.incubation_accelerator; } catch (_) { g.effects.incubation_accelerator = null; }
        }
      } else {
        try { delete g.effects.incubation_accelerator; } catch (_) { g.effects.incubation_accelerator = null; }
      }
    }
  } catch (e) {
    logger.warn && logger.warn('Failed applying incubation_accelerator effect', { discordId, guildId, error: e && (e.stack || e) });
  }
  const curEggs = Number((g.eggs && g.eggs[eggTypeId]) || (g.items && g.items[eggTypeId]) || 0);
  if (curEggs <= 0) throw new Error('No egg of that type to hatch');
  if (g.eggs && typeof g.eggs === 'object' && (eggTypeId in g.eggs || Object.keys(g.eggs).length > 0)) {
    g.eggs[eggTypeId] = curEggs - 1;
  } else if (g.items && typeof g.items === 'object') {
    g.items[eggTypeId] = Math.max(0, curEggs - 1);
  } else {
    g.eggs = g.eggs || {};
    g.eggs[eggTypeId] = curEggs - 1;
  }
  await userModel.updateUserDataRawById(user.id, data);

  const startedAt = Date.now();
  const finishesAt = startedAt + Number(durationMs || 60 * 1000);
  const insert = await db.knex('hatches').insert({ discord_id: discordId, guild_id: guildId, egg_type: eggTypeId, started_at: startedAt, finishes_at: finishesAt });
  const id = Array.isArray(insert) ? insert[0] : insert;
  const guildName = getGuildName(guildId);
  logger.info(`Created hatch (${guildName})`, { id, discordId, guildId, eggTypeId, finishesAt });
  scheduleTimer(id, finishesAt - Date.now());
  return { id, discord_id: discordId, guild_id: guildId, egg_type: eggTypeId, started_at: startedAt, finishes_at: finishesAt };
}

async function skipHatch(discordId, guildId, hatchId, costRoyalJelly = 5) {
  const row = await db.knex('hatches').where({ id: hatchId, discord_id: discordId, guild_id: guildId, collected: false }).first();
  if (!row) throw new Error('Hatch not found');
  const now = Date.now();
  if (Number(row.finishes_at) <= now) return true;
  const newAmt = await userModel.modifyCurrencyForGuild(discordId, guildId, 'royal_jelly', -Number(costRoyalJelly));
  if (Number(newAmt) < 0) {
    await userModel.modifyCurrencyForGuild(discordId, guildId, 'royal_jelly', Number(costRoyalJelly));
    throw new Error('Insufficient royal jelly');
  }
  await db.knex('hatches').where({ id: hatchId }).update({ skipped: true, finishes_at: now });
  if (timers.has(hatchId)) {
    clearTimeout(timers.get(hatchId));
    timers.delete(hatchId);
  }
  const guildName = getGuildName(guildId);
  logger.info(`Hatch skipped (${guildName})`, { hatchId, discordId, guildId, cost: costRoyalJelly });
  return true;
}

async function collectHatch(discordId, guildId, hatchId) {
  const row = await db.knex('hatches').where({ id: hatchId, discord_id: discordId, guild_id: guildId, collected: false }).first();
  if (!row) throw new Error('Hatch not found');
  const now = Date.now();
  if (Number(row.finishes_at) > now) throw new Error('Hatch is not ready yet');
  let nextStage = 'facehugger';
  let pathway = 'standard';
  try {
    const eggTypesConfig = require('../../config/eggTypes.json');
    const evolConfig = require('../../config/evolutions.json');
    const eggDef = Array.isArray(eggTypesConfig) ? eggTypesConfig.find(e => e.id === row.egg_type) : null;
    if (eggDef && eggDef.next_stage) nextStage = eggDef.next_stage;
    if (evolConfig && evolConfig.eggPathways && evolConfig.eggPathways[row.egg_type]) pathway = String(evolConfig.eggPathways[row.egg_type]);
    else if (eggDef && eggDef.pathway) pathway = String(eggDef.pathway);
  } catch (e) {
    logger.warn('Failed loading egg type config in collectHatch', { error: e && e.message });
  }
  try {
    await xenoModel.createXeno(discordId, { pathway, role: nextStage, stage: nextStage, data: { fromEgg: row.egg_type }, guildId });
  } catch (e) {
    logger.warn('Failed creating xenomorph in collectHatch', { error: e && e.message });
    try { await userModel.addItemForGuild(discordId, guildId, 'facehugger', 1); } catch (_) { /* ignore */ void 0; }
  }
  await db.knex('hatches').where({ id: hatchId }).update({ collected: true });
  const guildName = getGuildName(guildId);
  logger.info(`Hatch collected (${guildName})`, { hatchId, discordId, guildId });
  return true;
}

async function listHatches(discordId, guildId) {
  const rows = await db.knex('hatches').where({ discord_id: discordId, guild_id: guildId }).orderBy('id', 'desc').limit(50);
  return rows.map(r => ({ id: r.id, egg_type: r.egg_type, started_at: Number(r.started_at), finishes_at: Number(r.finishes_at), collected: !!r.collected, skipped: !!r.skipped }));
}

module.exports = { init, startHatch, skipHatch, collectHatch, listHatches };

async function shutdown() {
  try {
    for (const [, t] of timers.entries()) {
      try { clearTimeout(t); } catch (e) { try { logger && logger.warn && logger.warn('Failed clearing hatch timer during shutdown', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger && fallbackLogger.warn && fallbackLogger.warn('Failed logging timer clear error during hatchManager shutdown', le && (le.stack || le)); } catch (ignored) { /* ignore */ void 0; } } }
    }
    timers.clear();
    logger.info('hatchManager shutdown: cleared timers');
  } catch (e) {
    logger.warn('hatchManager shutdown error', { error: e && (e.stack || e) });
  }
}

module.exports.shutdown = shutdown;
