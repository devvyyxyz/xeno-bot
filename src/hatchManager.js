const db = require('./db');
const logger = require('./utils/logger').get('hatch');
const userModel = require('./models/user');
const eggTypes = require('../config/eggTypes.json');

let timers = new Map(); // hatchId -> timeout

async function init() {
  try {
    const rows = await db.knex('hatches').where({ collected: false }).select('*');
    for (const r of rows) {
      const now = Date.now();
      const finishes = Number(r.finishes_at) || now;
      if (finishes <= now) {
        // ready to collect, no timer necessary
        logger.info('Hatch ready on init', { id: r.id, discord_id: r.discord_id, guild_id: r.guild_id, egg_type: r.egg_type });
        continue;
      }
      const delay = finishes - now;
      scheduleTimer(r.id, delay);
      logger.info('Restored hatch timer', { id: r.id, discord_id: r.discord_id, guild_id: r.guild_id, in_ms: delay });
    }
  } catch (e) {
    logger.error('Failed initializing hatch manager', { error: e && (e.stack || e) });
  }
}

function scheduleTimer(hatchId, delay) {
  if (timers.has(hatchId)) {
    clearTimeout(timers.get(hatchId));
  }
  const t = setTimeout(() => {
    timers.delete(hatchId);
    logger.info('Hatch finished timer fired', { hatchId });
    // nothing else to do here — record is persisted and will be collectible
  }, delay);
  timers.set(hatchId, t);
}

// Start a hatch: consumes one egg from the user's inventory and creates a hatch row.
// durationMs is the hatch time. Returns the created hatch row.
async function startHatch(discordId, guildId, eggTypeId, durationMs) {
  const user = await userModel.getUserByDiscordId(discordId);
  if (!user) throw new Error('User not found');
  const data = user.data || {};
  data.guilds = data.guilds || {};
  const g = data.guilds[guildId] = data.guilds[guildId] || { eggs: {}, items: {}, currency: {} };
  const curEggs = Number((g.eggs && g.eggs[eggTypeId]) || 0);
  if (curEggs <= 0) throw new Error('No egg of that type to hatch');
  // decrement egg
  g.eggs[eggTypeId] = curEggs - 1;
  await userModel.updateUserDataRawById(user.id, data);

  const startedAt = Date.now();
  const finishesAt = startedAt + Number(durationMs || 60 * 1000);
  const insert = await db.knex('hatches').insert({ discord_id: discordId, guild_id: guildId, egg_type: eggTypeId, started_at: startedAt, finishes_at: finishesAt });
  const id = Array.isArray(insert) ? insert[0] : insert;
  logger.info('Created hatch', { id, discordId, guildId, eggTypeId, finishesAt });
  scheduleTimer(id, finishesAt - Date.now());
  return { id, discord_id: discordId, guild_id: guildId, egg_type: eggTypeId, started_at: startedAt, finishes_at: finishesAt };
}

// Skip hatch: pay royal jelly to complete instantly. costRoyalJelly can be number or function of egg type.
async function skipHatch(discordId, guildId, hatchId, costRoyalJelly = 5) {
  const row = await db.knex('hatches').where({ id: hatchId, discord_id: discordId, guild_id: guildId, collected: false }).first();
  if (!row) throw new Error('Hatch not found');
  const now = Date.now();
  if (Number(row.finishes_at) <= now) return true; // already finished
  // charge user
  const newAmt = await userModel.modifyCurrencyForGuild(discordId, guildId, 'royal_jelly', -Number(costRoyalJelly));
  if (Number(newAmt) < 0) {
    // roll back
    await userModel.modifyCurrencyForGuild(discordId, guildId, 'royal_jelly', Number(costRoyalJelly));
    throw new Error('Insufficient royal jelly');
  }
  // mark skipped and set finishes_at to now
  await db.knex('hatches').where({ id: hatchId }).update({ skipped: true, finishes_at: now });
  if (timers.has(hatchId)) {
    clearTimeout(timers.get(hatchId));
    timers.delete(hatchId);
  }
  logger.info('Hatch skipped', { hatchId, discordId, guildId, cost: costRoyalJelly });
  return true;
}

// Collect a finished hatch, granting a facehugger to the user (item id: 'facehugger')
async function collectHatch(discordId, guildId, hatchId) {
  const row = await db.knex('hatches').where({ id: hatchId, discord_id: discordId, guild_id: guildId, collected: false }).first();
  if (!row) throw new Error('Hatch not found');
  const now = Date.now();
  if (Number(row.finishes_at) > now) throw new Error('Hatch is not ready yet');
  // grant facehugger item
  await userModel.addItemForGuild(discordId, guildId, 'facehugger', 1);
  await db.knex('hatches').where({ id: hatchId }).update({ collected: true });
  logger.info('Hatch collected', { hatchId, discordId, guildId });
  return true;
}

async function listHatches(discordId, guildId) {
  const rows = await db.knex('hatches').where({ discord_id: discordId, guild_id: guildId }).orderBy('id', 'desc').limit(50);
  return rows.map(r => ({ id: r.id, egg_type: r.egg_type, started_at: Number(r.started_at), finishes_at: Number(r.finishes_at), collected: !!r.collected, skipped: !!r.skipped }));
}

module.exports = { init, startHatch, skipHatch, collectHatch, listHatches };

// Shutdown helper: clear any pending timers
async function shutdown() {
  try {
    for (const [id, t] of timers.entries()) {
      try { clearTimeout(t); } catch (e) { try { logger && logger.warn && logger.warn('Failed clearing hatch timer during shutdown', { error: e && (e.stack || e) }); } catch (le) { try { console.warn('Failed logging timer clear error during hatchManager shutdown', le && (le.stack || le)); } catch (ignored) {} } }
    }
    timers.clear();
    logger.info('hatchManager shutdown: cleared timers');
  } catch (e) {
    logger.warn('hatchManager shutdown error', { error: e && (e.stack || e) });
  }
}

module.exports.shutdown = shutdown;
