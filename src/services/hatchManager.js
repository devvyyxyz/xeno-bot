const db = require('../db');
const utils = require('../utils');
const logger = utils.logger.get('hatch');
const fallbackLogger = utils.fallbackLogger;
const models = require('../models');
const userModel = models.user;
const eggTypes = require('../../config/eggTypes.json');
void eggTypes;
const xenoModel = models.xenomorph;

// Optional BullMQ queue support for delayed hatch jobs. We attempt to
// require the local `lib/queue` helper but tolerate absence/failures
// and fall back to the legacy per-hatch timers implementation.
let hatchQueue = null;
let hatchWorker = null;
let useBull = false;
let createQueue = null;
let createWorker = null;
try {
  const qlib = require('../lib/queue');
  createQueue = qlib && qlib.createQueue;
  createWorker = qlib && qlib.createWorker;
} catch (e) {
  // ignore - fallback to timers
}

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
let timerCreatedAt = new Map(); // Track when each timer was created for stuck timer detection
let client = null;
let shuttingDown = false;
let timerMonitorInterval = null;

// Max age for legacy timers (longer than the longest hatch duration of 7 days, with buffer)
const LEGACY_TIMER_MAX_AGE_MS = Number(process.env.HATCH_TIMER_MAX_AGE_MS) || 8 * 24 * 60 * 60 * 1000; // 8 days
const HATCH_INIT_CHUNK_SIZE = Number(process.env.HATCH_INIT_CHUNK_SIZE) || 200;
const HATCH_INIT_CHUNK_DELAY_MS = Number(process.env.HATCH_INIT_CHUNK_DELAY_MS) || 20;

async function init(botClient) {
  client = botClient || null;
  let restoredHatches = 0;
  let skippedExpired = 0;
  let chunkCount = 0;
  try {
    const mu = process.memoryUsage();
    logger.info('hatchManager.init memory start', { heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10 });
  } catch (e) { /* ignore */ }
  try {
    // Try to initialize a Redis-backed queue/worker for hatch timers. If
    // queue creation fails for any reason, fall back to legacy timers.
    if (typeof createQueue === 'function') {
      try {
        hatchQueue = createQueue('hatches');
        if (typeof createWorker === 'function') {
          hatchWorker = createWorker('hatches', async (job) => {
            try {
              const hatchId = job?.data?.hatchId || job?.data?.hatch_id || null;
              logger.info('Hatch finished job processed', { hatchId });
            } catch (we) {
              logger.warn('Hatch worker processor error', { error: we && (we.stack || we) });
            }
          }, { concurrency: 1 });
        }
        useBull = true;
      } catch (qe) {
        logger.warn('Failed initializing hatch queue/worker; falling back to timers', { error: qe && (qe.stack || qe) });
        useBull = false;
        try { hatchQueue = null; if (hatchWorker && typeof hatchWorker.close === 'function') await hatchWorker.close(); } catch (_) { /* ignore */ }
      }
    }

    let lastId = 0;
    while (!shuttingDown) {
      const rows = await db.knex('hatches')
        .where({ collected: false })
        .andWhere('id', '>', lastId)
        .select('id', 'discord_id', 'guild_id', 'egg_type', 'started_at', 'finishes_at', 'skipped')
        .orderBy('id', 'asc')
        .limit(HATCH_INIT_CHUNK_SIZE);

      if (!rows || rows.length === 0) break;

      const now = Date.now();
      for (const r of rows) {
        lastId = Number(r.id) || lastId;
        const finishes = Number(r.finishes_at) || now;
        if (finishes <= now) {
          skippedExpired += 1;
          continue;
        }

        const delay = finishes - now;
        try {
          await scheduleTimer(r.id, delay);
          restoredHatches += 1;
          const guildName = getGuildName(r.guild_id);
          logger.debug(`Restored hatch timer (${guildName})`, {
            id: r.id,
            discord_id: r.discord_id,
            guild_id: r.guild_id,
            in_ms: delay,
          });
        } catch (sErr) {
          logger.warn('Failed scheduling hatch via queue; using timer fallback', {
            hatchId: r.id,
            error: sErr && (sErr.stack || sErr),
          });
          scheduleTimer(r.id, delay).catch(() => {});
          restoredHatches += 1;
        }
      }

      chunkCount += 1;
      if (chunkCount === 1 || chunkCount % 25 === 0 || rows.length < HATCH_INIT_CHUNK_SIZE) {
        try {
          const muChunk = process.memoryUsage();
          logger.debug('hatchManager.init chunk progress', {
            heapUsedMb: Math.round((muChunk.heapUsed / 1024 / 1024) * 10) / 10,
            restoredHatches,
            skippedExpired,
            lastId,
            chunkCount,
          });
        } catch (e) { /* ignore */ }
      }

      if (rows.length < HATCH_INIT_CHUNK_SIZE) break;
      await new Promise((res) => setTimeout(res, HATCH_INIT_CHUNK_DELAY_MS));
    }
  } catch (e) {
    logger.error('Failed initializing hatch manager', { error: e && (e.stack || e) });
  }
  try {
    const mu = process.memoryUsage();
    logger.info('hatchManager.init memory end', {
      heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10,
      restoredHatches,
      skippedExpired,
    });
  } catch (e) { /* ignore */ }
  try {
    utils.systemMonitor.registerSystem('hatchManager', { name: 'Hatch Manager', shutdown: shutdown });
  } catch (e) { logger.warn('Failed registering hatchManager with systemMonitor', { error: e && (e.stack || e) }); }

  // Start periodic timer monitoring to detect stuck timers
  startTimerMonitoring();
}

async function scheduleTimer(hatchId, delay) {
  if (shuttingDown) {
    try { logger && logger.info && logger.info('Skipping scheduleTimer: system is shutting down', { hatchId }); } catch (_) { /* ignore */ }
    return;
  }

  // Prefer Redis-backed delayed jobs when possible
  if (useBull && hatchQueue) {
    const jobId = `hatch:${hatchId}`;
    try {
      const existing = await hatchQueue.getJob(jobId);
      if (existing) {
        // If job exists, attempt to remove and recreate to ensure delay is up-to-date
        try { await existing.remove(); } catch (_) { /* ignore */ }
      }
      await hatchQueue.add('hatchFinish', { hatchId }, { jobId, delay: Number(delay) || 0, removeOnComplete: true, removeOnFail: true });
      return;
    } catch (e) {
      logger.warn('Failed scheduling hatch job in queue; falling back to timer', { hatchId, error: e && (e.stack || e) });
      // fall through to timer code
    }
  }

  // Legacy per-hatch timer fallback
  if (timers.has(hatchId)) {
    try { clearTimeout(timers.get(hatchId)); } catch (_) { /* ignore */ }
  }
  const t = setTimeout(() => {
    timers.delete(hatchId);
    timerCreatedAt.delete(hatchId);
    logger.info('Hatch finished timer fired', { hatchId });
  }, Number(delay) || 0);
  if (typeof t.unref === 'function') t.unref();
  timers.set(hatchId, t);
  timerCreatedAt.set(hatchId, Date.now());
}

async function startHatch(discordId, guildId, eggTypeId, durationMs) {
  if (shuttingDown) throw new Error('hatchManager is shutting down, cannot start new hatch');
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
  // schedule via queue (async) but don't block return; ensure failures are logged
  scheduleTimer(id, finishesAt - Date.now()).catch((err) => logger.warn('Failed scheduling hatch timer for new hatch', { hatchId: id, error: err && (err.stack || err) }));
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
  // Remove any scheduled job (queue or timer)
  try {
    if (useBull && hatchQueue) {
      const job = await hatchQueue.getJob(`hatch:${hatchId}`);
      if (job) await job.remove();
    }
  } catch (e) {
    logger.warn('Failed removing hatch job from queue during skip', { hatchId, error: e && (e.stack || e) });
  }
  if (timers.has(hatchId)) {
    try { clearTimeout(timers.get(hatchId)); } catch (_) { /* ignore */ }
    timers.delete(hatchId);
    timerCreatedAt.delete(hatchId);
  }
  const guildName = getGuildName(guildId);
  logger.info(`Hatch skipped (${guildName})`, { hatchId, discordId, guildId, cost: costRoyalJelly });
  return true;
}

async function collectHatch(discordId, guildId, hatchId) {
  try {
    const mu = process.memoryUsage();
    logger.info('collectHatch memory start', { hatchId, heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10 });
  } catch (e) { /* ignore */ }
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
    if (evolConfig && evolConfig.eggPathways) {
      const rawKey = String(row.egg_type || '').trim();
      // Direct lookup first
      if (rawKey && evolConfig.eggPathways[rawKey]) {
        pathway = String(evolConfig.eggPathways[rawKey]);
      } else if (rawKey) {
        // Try normalized variants (remove underscores/dashes and lowercase)
        const normalized = rawKey.replace(/[_-]/g, '').toLowerCase();
        for (const [k, v] of Object.entries(evolConfig.eggPathways)) {
          if (String(k).replace(/[_-]/g, '').toLowerCase() === normalized) {
            pathway = String(v);
            break;
          }
        }
      }
    }
    // fallback to eggDef.pathway if present
    if (( !pathway || pathway === 'standard') && eggDef && eggDef.pathway) pathway = String(eggDef.pathway);
  } catch (e) {
    logger.warn('Failed loading egg type config in collectHatch', { error: e && e.message });
  }
  try {
    // Do not auto-attach hatched xenomorphs to hives; attaching should be done via hive commands
    await xenoModel.createXeno(discordId, { pathway, role: nextStage, stage: nextStage, data: { fromEgg: row.egg_type }, guildId, attachToHive: false });
  } catch (e) {
    logger.warn('Failed creating xenomorph in collectHatch', { error: e && e.message });
    try { await userModel.addItemForGuild(discordId, guildId, 'facehugger', 1); } catch (_) { /* ignore */ void 0; }
  }
  await db.knex('hatches').where({ id: hatchId }).update({ collected: true });
  const guildName = getGuildName(guildId);
  logger.info(`Hatch collected (${guildName})`, { hatchId, discordId, guildId });
  try {
    const mu = process.memoryUsage();
    logger.info('collectHatch memory end', { hatchId, heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10 });
  } catch (e) { /* ignore */ }
  return true;
}

async function listHatches(discordId, guildId) {
  const rows = await db.knex('hatches').where({ discord_id: discordId, guild_id: guildId }).orderBy('id', 'desc').limit(50);
  return rows.map(r => ({ id: r.id, egg_type: r.egg_type, started_at: Number(r.started_at), finishes_at: Number(r.finishes_at), collected: !!r.collected, skipped: !!r.skipped }));
}

// Periodic monitoring for stuck timers to detect memory leaks
function startTimerMonitoring() {
  if (timerMonitorInterval) return; // Already running
  const MONITOR_INTERVAL_MS = Number(process.env.HATCH_TIMER_MONITOR_INTERVAL_MS) || 60 * 60 * 1000; // 1 hour
  timerMonitorInterval = setInterval(() => {
    try {
      const now = Date.now();
      let stuckCount = 0;
      for (const [hatchId, createdAt] of timerCreatedAt.entries()) {
        const age = now - createdAt;
        if (age > LEGACY_TIMER_MAX_AGE_MS) {
          logger.warn('Removing stuck hatch timer (exceeded max age)', { hatchId, ageHours: Math.round(age / 1000 / 60 / 60) });
          const t = timers.get(hatchId);
          if (t) clearTimeout(t);
          timers.delete(hatchId);
          timerCreatedAt.delete(hatchId);
          stuckCount++;
        }
      }
      if (stuckCount > 0 && timerCreatedAt.size > 0) {
        logger.info('Timer monitoring: removed stuck timers', { stuckCount, remainingTimers: timers.size });
      }
    } catch (e) {
      logger.warn('Error in timer monitoring', { error: e && (e.stack || e) });
    }
  }, MONITOR_INTERVAL_MS);
  if (typeof timerMonitorInterval.unref === 'function') timerMonitorInterval.unref();
}

function stopTimerMonitoring() {
  if (timerMonitorInterval) {
    clearInterval(timerMonitorInterval);
    timerMonitorInterval = null;
  }
}

module.exports = { init, startHatch, skipHatch, collectHatch, listHatches };

async function shutdown() {
  shuttingDown = true;
  try {
    // Stop timer monitoring
    stopTimerMonitoring();
    
    // close bull worker/queue if used
    try {
      if (hatchWorker && typeof hatchWorker.close === 'function') await hatchWorker.close();
    } catch (we) { logger.warn('Failed closing hatch worker', { error: we && (we.stack || we) }); }
    try {
      if (hatchQueue && typeof hatchQueue.close === 'function') await hatchQueue.close();
    } catch (qe) { logger.warn('Failed closing hatch queue', { error: qe && (qe.stack || qe) }); }

    for (const [, t] of timers.entries()) {
      try { clearTimeout(t); } catch (e) {
        try { logger && logger.warn && logger.warn('Failed clearing hatch timer during shutdown', { error: e && (e.stack || e) }); } catch (le) {
          try { fallbackLogger && fallbackLogger.warn && fallbackLogger.warn('Failed logging timer clear error during hatchManager shutdown', le && (le.stack || le)); } catch (ignored) { /* ignore */ void 0; }
        }
      }
    }
    timers.clear();
    timerCreatedAt.clear();
    logger.info('hatchManager shutdown: cleared timers and queue (if any)');
  } catch (e) {
    logger.warn('hatchManager shutdown error', { error: e && (e.stack || e) });
  }
}

// Clean up hatch timers for a specific guild (called when guild is deleted)
async function cleanupGuild(guildId) {
  const gid = String(guildId);
  try {
    // Remove all timers associated with hatches from this guild
    // Note: We don't have direct guild->hatchId mapping in timers Map,
    // so we rely on natural cleanup when hatches are collected/skipped/completed
    logger.info('cleanupGuild: guild cleanup initiated (timers cleaned via natural expiration)', { guildId: gid });
  } catch (e) {
    logger.warn('cleanupGuild error', { guildId: gid, error: e && (e.stack || e) });
  }
}

module.exports.shutdown = shutdown;
module.exports.cleanupGuild = cleanupGuild;
