const models = require('./models');
const guildModel = models.guild;
const userModel = models.user;
const utils = require('./utils');
const baseLogger = utils.logger;
const logger = baseLogger.get('spawn');
const fallbackLogger = utils.fallbackLogger;
const emojis = require('../config/emojis.json');
const eggTypes = require('../config/eggTypes.json');
const path = require('path');
const fs = require('fs');
const { PermissionsBitField } = require('discord.js');
const { ContainerBuilder, TextDisplayBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const db = require('./db');
const { Duration } = require('luxon');

// Helper: Get guild name for logging
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
    // Try converting to string if it's not found
    const guildById = client.guilds.cache.get(String(guildId));
    if (guildById && guildById.name) {
      return guildById.name;
    }
    logger.debug &&
      logger.debug('getGuildName: guild not in cache', {
        guildId,
        cacheSize: client.guilds.cache.size,
      });
    return `Guild-${guildId}`;
  } catch (e) {
    logger.warn && logger.warn('getGuildName error', { guildId, error: e.message });
    return `Guild-${guildId}`;
  }
}

let client = null;
// activeEggs: guildId -> Map(messageId -> { messageId, channelId, value, spawnedAt })
let activeEggs = new Map();
let timers = new Map();
let shuttingDown = false;
// preload spawn image into memory (optional) to avoid repeated large sync reads
let spawnImageBuffer = null;
const spawnImagePath = path.join(__dirname, '../assets/images/egg_spawn.png');
const pendingReschedule = new Set();
// nextSpawnAt: guildId -> timestamp (ms since epoch) when the next spawn is scheduled
let nextSpawnAt = new Map();
// inProgress: guildId set to prevent concurrent doSpawn runs
let inProgress = new Set();
// lastSpawnAt: guildId -> timestamp of last completed spawn, used to suppress near-duplicate spawns
let lastSpawnAt = new Map();
// uncaughtEggTimeout: guildId -> timeout ID for cleaning up uncaught eggs after 30 minutes
const uncaughtEggTimeout = new Map();
const UNCAUGHT_EGG_TIMEOUT_MS = Number(process.env.UNCAUGHT_EGG_TIMEOUT_MS) || 30 * 60 * 1000;
// failureTracker: guildId -> { count, lastFailTime } to implement exponential backoff
const failureTracker = new Map();
// guildSendMode: guildId -> 'v2' | 'legacy' to avoid repeated V2 failures on unsupported channels
const guildSendMode = new Map();
// warnCooldowns: key -> last log timestamp, to reduce repeated warning spam
const warnCooldowns = new Map();
const maxConcurrentSpawns = Math.max(1, Number(process.env.SPAWN_MAX_CONCURRENT) || 3);
const maxSpawnQueueDepth = Number(process.env.SPAWN_QUEUE_MAX_DEPTH) || 100; // safety limit to prevent memory accumulation
const spawnQueue = [];
let activeSpawnWorkers = 0;

// Central poller and cleanup intervals (avoid one timer per guild)
let spawnPollInterval = null;
let spawnCleanupInterval = null;
// Shard-local guild set and in-flight enqueue tracking
let shardGuildSet = new Set();
let enqueuedSet = new Set();
const SPAWN_POLL_MS = Number(process.env.SPAWN_SCHED_POLL_MS) || 5000;
const SPAWN_POLL_DB_LIMIT = Number(process.env.SPAWN_SCHED_DB_LIMIT) || 200;
const SPAWN_CLEANUP_MS = Number(process.env.SPAWN_CLEANUP_MS) || 10 * 60 * 1000;
const FAILURE_TRACKER_TTL = Number(process.env.SPAWN_FAILURE_TRACKER_TTL_MS) || 10 * 60 * 1000;
const WARN_COOLDOWN_TTL = Number(process.env.SPAWN_WARN_COOLDOWN_TTL_MS) || 24 * 60 * 60 * 1000;
const WORKER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const SPAWN_JOB_CLAIM_LIMIT = Number(process.env.SPAWN_JOB_CLAIM_LIMIT) || 50;
const SPAWN_JOB_STALE_MS = Number(process.env.SPAWN_JOB_STALE_MS) || 5 * 60 * 1000;
const LAST_SPAWN_AT_TTL = Number(process.env.LAST_SPAWN_AT_TTL_MS) || 60 * 60 * 1000; // 1 hour

async function upsertSpawnJob(guildId, scheduledAt) {
  try {
    const knex = db.knex;
    // Use ON CONFLICT / ON DUPLICATE KEY UPDATE via knex onConflict().merge()
    await knex('spawn_jobs')
      .insert({ guild_id: String(guildId), scheduled_at: Number(scheduledAt) })
      .onConflict('guild_id')
      .merge({ scheduled_at: Number(scheduledAt), updated_at: knex.fn.now() });
  } catch (e) {
    // If table missing or DB error, log and continue gracefully
    try {
      logger && logger.warn && logger.warn('Failed upserting spawn_jobs row', { guildId, scheduledAt, error: e && (e.stack || e) });
    } catch (_) {}
  }
}

function chunkArray(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function warnWithCooldown(key, message, meta = {}, cooldownMs = 15 * 60 * 1000) {
  const now = Date.now();
  const last = warnCooldowns.get(key) || 0;
  if (now - last < cooldownMs) return;
  warnCooldowns.set(key, now);
  logger.warn(message, meta);
}

function getSpawnBackoffDelay(guildId) {
  const tracker = failureTracker.get(guildId);
  if (!tracker) return 0; // No failures, no backoff

  const now = Date.now();
  const timeSinceLastFailure = now - (tracker.lastFailTime || 0);
  const failureCount = tracker.count || 0;

  // Reset failure count if last failure was >5 minutes ago
  if (timeSinceLastFailure > 5 * 60 * 1000) {
    failureTracker.delete(guildId);
    return 0;
  }

  // Cap failure count at 10 to prevent exponential explosion
  const cappedCount = Math.min(failureCount, 10);

  // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s, 1024s (max ~17 min)
  const backoffMs = Math.pow(2, cappedCount + 1) * 1000;
  return backoffMs;
}

function recordSpawnFailure(guildId) {
  const tracker = failureTracker.get(guildId) || { count: 0, lastFailTime: Date.now() };
  tracker.count += 1;
  tracker.lastFailTime = Date.now();
  failureTracker.set(guildId, tracker);
}

function isRateLimitError(error) {
  // Detect rate limit errors from Discord or DB
  if (!error) return false;
  const msg = (error.message || error.toString() || '').toLowerCase();
  const code = error.code || error.status || 0;
  // Discord rate limit: HTTP 429
  if (code === 429) return true;
  // Common rate limit error indicators
  if (msg.includes('rate limit') || msg.includes('too many requests')) return true;
  if (msg.includes('ratelimit')) return true;
  return false;
}

function isPermissionError(error) {
  // Detect permission errors that won't go away on retry
  if (!error) return false;
  const msg = (error.message || error.toString() || '').toLowerCase();
  const code = error.code || error.status || 0;
  // Discord permission denied: HTTP 403
  if (code === 403) return true;
  // Common permission error indicators
  if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('unauthorized'))
    return true;
  if (msg.includes('no attach') || (msg.includes('attach') && msg.includes('permission')))
    return true;
  return false;
}

// Central poller: query DB for due next_spawn_at rows and enqueue spawns.
async function spawnPollerTick() {
  if (shuttingDown) return;
  try {
    const knex = db.knex;
    const now = Date.now();
    const windowEnd = now + SPAWN_POLL_MS + 1000; // small buffer

    const guildIds = Array.from(shardGuildSet);
    if (!guildIds || guildIds.length === 0) return;
    const chunks = chunkArray(guildIds, SPAWN_POLL_DB_LIMIT || 200);
    for (const chunk of chunks) {
      try {
        // Claim due spawn_jobs using a transaction and SKIP LOCKED to avoid races
        await knex.transaction(async (trx) => {
          const staleThreshold = Date.now() - SPAWN_JOB_STALE_MS;
          const rows = await trx
            .select('id', 'guild_id', 'scheduled_at')
            .from('spawn_jobs')
            .whereIn('guild_id', chunk)
            .andWhere('scheduled_at', '<=', windowEnd)
            .andWhere(function () {
              this.whereNull('claimed_by').orWhere('claimed_at', '<', staleThreshold);
            })
            .orderBy('scheduled_at', 'asc')
            .forUpdate()
            .skipLocked()
            .limit(SPAWN_JOB_CLAIM_LIMIT || 50);

          if (!rows || rows.length === 0) return;

          const ids = rows.map((r) => r.id);
          // Mark claimed under the same transaction
          await trx('spawn_jobs').whereIn('id', ids).update({ claimed_by: WORKER_ID, claimed_at: Date.now() });

          // Enqueue claimed jobs outside the transaction context
          for (const r of rows) {
            try {
              const gid = String(r.guild_id);
              nextSpawnAt.set(gid, Number(r.scheduled_at));
              if (inProgress.has(gid) || enqueuedSet.has(gid)) continue;
              const active = activeEggs.get(gid);
              if (active && active.size > 0) continue;
              const backoff = getSpawnBackoffDelay(gid);
              if (backoff > 0) {
                const tracker = failureTracker.get(gid);
                const nextAllowed = tracker && tracker.lastFailTime ? tracker.lastFailTime + backoff : 0;
                if (Date.now() < nextAllowed) continue;
              }
              if (spawnQueue.length >= maxSpawnQueueDepth) {
                logger.warn('Spawn poller: spawn queue full; skipping enqueue', { guildId: gid, queueDepth: spawnQueue.length });
                continue;
              }
              enqueuedSet.add(gid);
              enqueueSpawn(gid).catch((err) => {
                enqueuedSet.delete(gid);
                logger.error('Failed enqueue spawn from job claim', { guildId: gid, error: err && (err.stack || err) });
              });
            } catch (inner) {
              logger.warn('spawnPoller: error enqueueing claimed job', { row: r, error: inner && (inner.stack || inner) });
            }
          }
        });
      } catch (e) {
        logger.warn('spawnPoller DB claim failed', { error: e && (e.stack || e) });
        continue;
      }
    }
  } catch (e) {
    logger.warn('spawnPollerTick unexpected error', { error: e && (e.stack || e) });
  }
}

function spawnCleanupTick() {
  try {
    const now = Date.now();
    // Clean expired failure tracker entries
    for (const [gid, tracker] of failureTracker.entries()) {
      if (!tracker || !tracker.lastFailTime) continue;
      if (now - tracker.lastFailTime > FAILURE_TRACKER_TTL) failureTracker.delete(gid);
    }
    // Clean expired warn cooldown entries
    for (const [k, ts] of warnCooldowns.entries()) {
      if (now - ts > WARN_COOLDOWN_TTL) warnCooldowns.delete(k);
    }
    // Clean lastSpawnAt entries older than 1 hour to prevent unbounded growth
    for (const [gid, ts] of lastSpawnAt.entries()) {
      if (now - ts > LAST_SPAWN_AT_TTL) lastSpawnAt.delete(gid);
    }
    // Clean guild-specific maps when guild leaves shard
    if (shardGuildSet && shardGuildSet.size > 0) {
      for (const gid of Array.from(guildSendMode.keys())) {
        if (!shardGuildSet.has(String(gid))) guildSendMode.delete(gid);
      }
      for (const gid of Array.from(nextSpawnAt.keys())) {
        if (!shardGuildSet.has(String(gid))) nextSpawnAt.delete(gid);
      }
      for (const gid of Array.from(lastSpawnAt.keys())) {
        if (!shardGuildSet.has(String(gid))) lastSpawnAt.delete(gid);
      }
    }
    for (const gid of Array.from(enqueuedSet)) {
      if (shardGuildSet && shardGuildSet.size > 0 && !shardGuildSet.has(String(gid))) enqueuedSet.delete(gid);
    }
    
    // Log memory and state periodically
    try {
      const mu = process.memoryUsage();
      const totalActiveEggs = Array.from(activeEggs.values()).reduce((sum, map) => sum + map.size, 0);
      const heapPercent = Math.round((mu.heapUsed / mu.heapTotal) * 100);
      const channelCacheSize = client && client.channels && client.channels.cache ? client.channels.cache.size : 0;
      
      // Aggressive cache cleanup if channel cache grows too large
      if (channelCacheSize > 100) {
        try {
          if (client && client.channels && client.channels.cache) {
            client.channels.cache.clear();
            logger.warn('[SPAWN CLEANUP] Cleared oversized channel cache', { 
              cacheSize: channelCacheSize,
              heapPercent: `${heapPercent}%`
            });
          }
        } catch (_) { /* ignore */ }
      }
      
      if (heapPercent > 70) { // Only log when memory is elevated to avoid spam
        logger.warn('[SPAWN CLEANUP] Memory state', {
          activeEggCount: totalActiveEggs,
          activeEggGuilds: activeEggs.size,
          inProgressCount: inProgress.size,
          enqueuedCount: enqueuedSet.size,
          spawnQueueDepth: spawnQueue.length,
          failureTrackerSize: failureTracker.size,
          warnCooldownsSize: warnCooldowns.size,
          uncaughtEggTimeoutsSize: uncaughtEggTimeout.size,
          channelCacheSize,
          heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 100) / 100,
          heapPercent: `${heapPercent}%`,
        });
      }
    } catch (e) { /* ignore */ }
  } catch (e) {
    logger.warn('spawnCleanupTick error', { error: e && (e.stack || e) });
  }
}

function startPoller() {
  if (spawnPollInterval) return;
  spawnPollInterval = setInterval(() => {
    spawnPollerTick().catch((e) => logger.warn('spawnPollerTick error', { error: e && (e.stack || e) }));
  }, SPAWN_POLL_MS);
  spawnCleanupInterval = setInterval(() => {
    try {
      spawnCleanupTick();
    } catch (e) {
      logger.warn('spawnCleanupTick error', { error: e && (e.stack || e) });
    }
  }, SPAWN_CLEANUP_MS);
  // run immediately once
  spawnPollerTick().catch((e) => logger.warn('spawnPollerTick initial run failed', { error: e && (e.stack || e) }));
  spawnCleanupTick();
}

function stopPoller() {
  if (spawnPollInterval) {
    clearInterval(spawnPollInterval);
    spawnPollInterval = null;
  }
  if (spawnCleanupInterval) {
    clearInterval(spawnCleanupInterval);
    spawnCleanupInterval = null;
  }
  // Clear all pending uncaught egg timeouts
  for (const timeoutId of uncaughtEggTimeout.values()) {
    clearTimeout(timeoutId);
  }
  uncaughtEggTimeout.clear();
}

function enqueueSpawn(guildId, forcedEggTypeId, isForced = false) {
  if (shuttingDown) return Promise.reject(new Error('spawnManager is shutting down, cannot enqueue spawn'));
  // Prevent queue from growing unbounded during failure cascades
  if (spawnQueue.length >= maxSpawnQueueDepth) {
    logger.warn('Spawn queue depth limit reached; dropping new spawn request', {
      guildId,
      queueDepth: spawnQueue.length,
      maxDepth: maxSpawnQueueDepth,
    });
    return Promise.reject(new Error('Spawn queue full'));
  }
  return new Promise((resolve, reject) => {
    spawnQueue.push({ guildId, forcedEggTypeId, isForced, resolve, reject });
    processSpawnQueue();
  });
}

function processSpawnQueue() {
  while (activeSpawnWorkers < maxConcurrentSpawns && spawnQueue.length > 0) {
    const task = spawnQueue.shift();
    activeSpawnWorkers += 1;
    doSpawn(task.guildId, task.forcedEggTypeId, task.isForced)
      .then((result) => task.resolve(result))
      .catch((err) => {
        task.reject(err);
        // Clean up state on error to prevent stuck spawns
        try {
          inProgress.delete(task.guildId);
          enqueuedSet.delete(task.guildId);
        } catch (_) { /* ignore */ }
      })
      .finally(() => {
        activeSpawnWorkers -= 1;
        if (spawnQueue.length > 0) processSpawnQueue();
      });
  }
}

async function init(botClient) {
  client = botClient;
  // start schedules for guilds that belong to this shard
  try {
    try {
      const mu = process.memoryUsage();
      logger.info('spawnManager.init memory start', {
        heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10,
        rssMb: Math.round((mu.rss / 1024 / 1024) * 10) / 10,
      });
    } catch (e) { /* ignore */ }
      const knex = db.knex;
      const shardGuildIds = Array.from(client.guilds.cache.keys());
      const guildIdSet = new Set(shardGuildIds);
      const inChunkSize = Number(process.env.SPAWN_MANAGER_GUILD_CHUNK) || 250;
      const chunkDelayMs = Number(process.env.SPAWN_MANAGER_CHUNK_DELAY_MS) || 50;
      const guildIdChunks = chunkArray(shardGuildIds, inChunkSize);

      let totalLoadedGuildRows = 0;
      let totalRestoredActiveRows = 0;

      for (const ids of guildIdChunks) {
        if (!ids || ids.length === 0) continue;
        // Load guild settings for this chunk and process immediately to avoid accumulating a large `rows` array
        let chunkRows = [];
        try {
          chunkRows = await knex('guild_settings').whereIn('guild_id', ids).select('*');
          totalLoadedGuildRows += chunkRows.length;
        } catch (e) {
          logger.warn('Failed loading guild_settings chunk', { error: e && (e.stack || e), chunkSize: ids.length });
          continue;
        }
        try {
          const mu = process.memoryUsage();
          logger.info('spawnManager.init after guild_settings chunk', {
            heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10,
            loadedGuildRows: chunkRows.length,
            totalLoadedGuildRows,
          });
        } catch (e) { /* ignore */ }

        // Restore any active spawns for this chunk - but only keep the
        // most recent active spawn per guild to avoid memory growth from
        // multiple stale rows. Validate messages/channels and clean up
        // DB rows that are invalid.
        try {
          const activeChunkRows = await knex('active_spawns').whereIn('guild_id', ids).select('*');
          totalRestoredActiveRows += activeChunkRows.length;
          // Pick latest spawn per guild
          const latestByGuild = new Map();
          for (const r of activeChunkRows) {
            const gid = String(r.guild_id);
            const cur = latestByGuild.get(gid);
            if (!cur || Number(r.spawned_at) > Number(cur.spawned_at)) latestByGuild.set(gid, r);
          }
          for (const [gid, r] of latestByGuild.entries()) {
            try {
              if (!guildIdSet.has(String(r.guild_id))) continue;
              const ch = await client.channels.fetch(r.channel_id).catch(() => null);
              if (!ch) {
                // channel missing, cleanup
                await knex('active_spawns').where({ id: r.id }).del();
                continue;
              }
              // ensure message exists so users can still catch
              const msg = await ch.messages.fetch(r.message_id).catch(() => null);
              if (!msg) {
                await knex('active_spawns').where({ id: r.id }).del();
                continue;
              }
              try {
                const spawnedAtNum = Number(r.spawned_at) || 0;
                const ageMismatchMs = Math.abs((msg.createdTimestamp || 0) - spawnedAtNum);
                const maxMismatch = 1000 * 60 * 60; // 1 hour tolerance
                if (msg.author?.id !== client.user?.id || ageMismatchMs > maxMismatch) {
                  logger.info('Cleaned up stale active spawn (message validation failed)', {
                    messageId: r.message_id,
                    channelId: r.channel_id,
                    ageMismatchMs,
                  });
                  await knex('active_spawns').where({ id: r.id }).del();
                  // remove cached message/channel references to avoid growing cache
                  try {
                    if (ch && ch.messages && ch.messages.cache) ch.messages.cache.delete(String(r.message_id));
                  } catch (_) {}
                  try { client.channels.cache.delete(String(r.channel_id)); } catch (_) {}
                  continue;
                }
                // After successful validation, immediately remove the fetched message and channel from caches
                try {
                  if (ch && ch.messages && ch.messages.cache) ch.messages.cache.delete(String(r.message_id));
                } catch (_) {}
                try { client.channels.cache.delete(String(r.channel_id)); } catch (_) {}
              } catch (valErr) {
                try {
                  logger.warn('Error validating restored active spawn; removing row', {
                    row: r,
                    error: valErr && (valErr.stack || valErr),
                  });
                } catch (le) {
                  try {
                    logger && logger.warn && logger.warn('Failed logging validation error restoring active spawn', {
                      error: le && (le.stack || le),
                    });
                  } catch (lle) {
                    fallbackLogger && fallbackLogger.warn && fallbackLogger.warn(
                      'Failed logging validation error restoring active spawn fallback',
                      lle && (lle.stack || lle)
                    );
                  }
                }
                await knex('active_spawns').where({ id: r.id }).del();
                continue;
              }
              // Check if egg is too old (more than 2 hours) - delete it immediately instead of restoring
              const eggAge = Date.now() - Number(r.spawned_at);
              const MAX_EGG_RESTORE_AGE = 2 * 60 * 60 * 1000; // 2 hours
              if (eggAge > MAX_EGG_RESTORE_AGE) {
                try {
                  await knex('active_spawns').where({ id: r.id }).del();
                  logger.info('Deleted stale restored active spawn (too old to restore)', {
                    messageId: r.message_id,
                    ageHours: Math.round(eggAge / 1000 / 60 / 60),
                  });
                } catch (delErr) {
                  logger.warn('Failed cleaning old active_spawn on restore', { id: r.id, error: delErr && (delErr.stack || delErr) });
                }
                continue;
              }
              const guildMap = activeEggs.get(r.guild_id) || new Map();
              const restoredEggType = eggTypes.find((t) => t.id === r.egg_type) || { id: r.egg_type };
              // store a minimal eggType blob to avoid retaining large config objects
              guildMap.set(r.message_id, {
                messageId: r.message_id,
                channelId: r.channel_id,
                spawnedAt: Number(r.spawned_at),
                numEggs: r.num_eggs,
                eggType: { id: restoredEggType.id, name: restoredEggType.name, emoji: restoredEggType.emoji },
              });
              activeEggs.set(r.guild_id, guildMap);
              // Set cleanup timeout for restored eggs immediately (they need cleanup just like newly spawned eggs)
              const gid = String(r.guild_id);
              if (uncaughtEggTimeout.has(gid)) {
                clearTimeout(uncaughtEggTimeout.get(gid));
              }
              const timeoutId = setTimeout(() => {
                const guildEggs = activeEggs.get(gid);
                if (guildEggs && guildEggs.size > 0) {
                  logger.warn('Cleaning up uncaught eggs from restored spawn after timeout', {
                    guildId: gid,
                    messageIds: Array.from(guildEggs.keys()),
                    timeoutMs: UNCAUGHT_EGG_TIMEOUT_MS,
                  });
                  activeEggs.delete(gid);
                  // Try to delete the message if still accessible
                  try {
                    for (const eggEvent of guildEggs.values()) {
                      client.channels.fetch(eggEvent.channelId).then((ch) => {
                        ch.messages.fetch(eggEvent.messageId).then((msg) => msg.delete()).catch(() => {});
                      }).catch(() => {});
                    }
                  } catch (_) { /* ignore */ }
                }
                uncaughtEggTimeout.delete(gid);
              }, UNCAUGHT_EGG_TIMEOUT_MS);
              uncaughtEggTimeout.set(gid, timeoutId);
            } catch (e) {
              try {
                logger.warn('Failed restoring active spawn row', {
                  row: r,
                  error: e && (e.stack || e),
                });
              } catch (le) {
                try {
                  logger && logger.warn && logger.warn('Failed logging restore active spawn error', {
                    error: le && (le.stack || le),
                  });
                } catch (lle) {
                  fallbackLogger && fallbackLogger.warn && fallbackLogger.warn(
                    'Failed logging restore active spawn error fallback',
                    lle && (lle.stack || lle)
                  );
                }
              }
            }
          }
          try {
            const mu = process.memoryUsage();
            logger.info('spawnManager.init after active_spawns chunk restore', {
              heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10,
              restoredActiveRows: activeChunkRows.length,
              totalRestoredActiveRows,
            });
          } catch (e) { /* ignore */ }
        } catch (e) {
          try {
            logger.warn('Failed loading active_spawns chunk', { error: e && (e.stack || e) });
          } catch (le) {
            try {
              logger && logger.warn && logger.warn('Failed logging active_spawns load error', { error: le && (le.stack || le) });
            } catch (lle) {
              fallbackLogger && fallbackLogger.warn && fallbackLogger.warn('Failed logging active_spawns load error fallback', lle && (lle.stack || lle));
            }
          }
        }

        // Schedule spawns for guilds in this chunk. Instead of creating per-guild
        // timers we record persisted schedules and rely on the central poller
        // to enqueue due spawns. If a persisted schedule is already due, enqueue
        // it immediately (guarded to avoid duplicates).
        for (const row of chunkRows) {
          if (!guildIdSet.has(String(row.guild_id))) continue;
          if (row.next_spawn_at) {
            const ts = Number(row.next_spawn_at);
            const remaining = Math.max(0, ts - Date.now());
            // Record persisted schedule in spawn_jobs (migrate from guild_settings to job table)
            try {
              await upsertSpawnJob(row.guild_id, ts);
              nextSpawnAt.set(row.guild_id, ts);
              logger.debug('Restored scheduled spawn into job table (no local timer)', {
                guildId: row.guild_id,
                scheduled_at: ts,
                in_ms: remaining,
              });
              // If already due, attempt to enqueue now (avoid duplicates and don't queue if eggs active)
              if (remaining <= 0) {
                try {
                  const gidStr = String(row.guild_id);
                  const guildEggs = activeEggs.get(gidStr);
                  const hasActiveEggs = guildEggs && guildEggs.size > 0;
                  // Prevent queueing if eggs are active or already processing
                  if (!hasActiveEggs && !inProgress.has(gidStr) && !enqueuedSet.has(gidStr)) {
                    // Safety check: don't queue if spawn queue is nearly full (prevent memory explosion during init)
                    if (spawnQueue.length >= maxSpawnQueueDepth * 0.8) {
                      logger.warn('Spawn queue near capacity during init; skipping enqueue', {
                        guildId: gidStr,
                        queueDepth: spawnQueue.length,
                        maxDepth: maxSpawnQueueDepth,
                      });
                      continue;
                    }
                    enqueuedSet.add(gidStr);
                    enqueueSpawn(gidStr).catch((err) => {
                      enqueuedSet.delete(gidStr);
                      logger.error('Spawn error from init enqueue', { guildId: gidStr, error: err && (err.stack || err) });
                    });
                  }
                } catch (e) {
                  logger.warn('Failed enqueueing due spawn during init', { guildId: row.guild_id, error: e && (e.stack || e) });
                }
              }
            } catch (migrateErr) {
              logger.warn('Failed migrating guild_settings.next_spawn_at into spawn_jobs', { guildId: row.guild_id, error: migrateErr && (migrateErr.stack || migrateErr) });
            }
            continue;
          }
          scheduleNext(row.guild_id);
        }

        // Small delay between chunks to let the event loop and GC breathe
        try {
          await new Promise((res) => setTimeout(res, chunkDelayMs));
        } catch (_) { /* ignore */ }
      }
      try {
        const mu = process.memoryUsage();
        logger.info('spawnManager.init complete', {
          heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10,
          totalLoadedGuildRows,
          totalRestoredActiveRows,
        });
      } catch (e) { /* ignore */ }
    // attempt to preload spawn image once to reduce transient allocations
    try {
      if (fs.existsSync(spawnImagePath)) {
        try {
          const stats = fs.statSync(spawnImagePath);
          const maxSize = Number(process.env.SPAWN_IMAGE_CACHE_MAX_BYTES) || 8 * 1024 * 1024;
          if (stats.size <= maxSize) {
            spawnImageBuffer = fs.readFileSync(spawnImagePath);
            logger.info('Preloaded spawn image into memory', { size: stats.size });
          } else {
            logger.info('Spawn image present but too large to preload', { size: stats.size, maxSize });
          }
        } catch (e) {
          logger.warn('Failed preloading spawn image', { error: e && (e.stack || e) });
        }
      }
    } catch (e) { /* ignore */ }

    logger.info('Spawn manager initialized', {
      shardGuilds: shardGuildIds.length,
      configuredGuilds: totalLoadedGuildRows,
      chunkSize: inChunkSize,
      maxConcurrentSpawns,
    });
    try {
      // Save shard guild set for the poller and start central poller/cleanup
      shardGuildSet = guildIdSet;
      startPoller();
    } catch (e) {
      logger.warn('Failed starting spawn poller', { error: e && (e.stack || e) });
    }
    try {
      const systemMonitor = require('./utils/systemMonitor');
      systemMonitor.registerSystem('spawnManager', { name: 'Spawn Manager', shutdown: shutdown });
    } catch (e) {
      logger.warn('Failed registering spawnManager with systemMonitor', {
        error: e && (e.stack || e),
      });
    }
  } catch (err) {
    logger.error('Failed initializing spawn manager', { error: err.stack || err });
  }
}

function scheduleNext(guildId) {
  if (shuttingDown) {
    try { logger && logger.info && logger.info('Skipping scheduleNext: system is shutting down', { guildId }); } catch (_) { /* ignore */ }
    return;
  }
  // Wrap async IIFE with error handler to prevent unhandled rejections
  (async () => {
    // Checkpoint 1: Check active eggs
    const activeMap = activeEggs.get(guildId);
    if (activeMap && activeMap.size > 0) {
      logger.info('Active eggs present; delaying schedule until cleared', {
        guildId,
        active: activeMap.size,
      });
      pendingReschedule.add(guildId);
      return;
    }

    // Checkpoint 2: Get guild config
    let cfg;
    try {
      cfg = await guildModel.getGuildConfig(guildId);
    } catch (cfgErr) {
      logger.warn('Failed to get guild config during scheduleNext', {
        guildId,
        error: cfgErr && (cfgErr.stack || cfgErr),
      });
      cfg = null;
    }

    const min = (cfg && cfg.spawn_min_seconds) || 60;
    const max = (cfg && cfg.spawn_max_seconds) || 3600;
    let delay = randomInt(min, max) * 1000;

    // Checkpoint 3: Apply exponential backoff for repeated failures
    const backoffDelay = getSpawnBackoffDelay(guildId);
    if (backoffDelay > 0) {
      delay = Math.max(delay, backoffDelay);
      logger.info('Applied exponential backoff to spawn schedule', {
        guildId,
        backoffMs: backoffDelay,
        totalDelayMs: delay,
      });
    }

    const scheduledAt = Date.now() + delay;

    // Checkpoint 4: Log debug info
    try {
      const guildName = client ? client.guilds.cache.get(guildId)?.name || null : null;
      const persistedNext = await (async () => {
        try {
          const k = db.knex;
          const row = await k('guild_settings').where({ guild_id: guildId }).first('next_spawn_at');
          return row && row.next_spawn_at;
        } catch (e) {
          return null;
        }
      })();
      logger.debug('About to schedule next spawn', {
        guildId,
        guildName,
        min,
        max,
        delay,
        scheduledAt,
        pendingReschedule: pendingReschedule.has(guildId),
        existingTimer: timers.has(guildId),
        persistedNext,
      });
    } catch (debugErr) {
      logger.debug('About to schedule next spawn (debug logging failed)', {
        guildId,
        min,
        max,
        delay,
        scheduledAt,
      });
    }

    // Persist to spawn_jobs table (DB-backed job) and record in-memory; central poller will enqueue when due.
    nextSpawnAt.set(guildId, scheduledAt);
    try {
      await upsertSpawnJob(guildId, scheduledAt);
    } catch (e) {
      logger.warn('Failed upserting spawn_jobs row during scheduleNext', { guildId, scheduledAt, error: e && (e.stack || e) });
    }
    // Also update legacy guild_settings.next_spawn_at for backwards compatibility
    try {
      const knex = db.knex;
      await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: scheduledAt });
    } catch (dbErr) {
      logger.warn('Failed persisting next_spawn_at to guild_settings', {
        guildId,
        error: dbErr && (dbErr.stack || dbErr),
      });
    }

    // Checkpoint 7: Log completion
    try {
      const guildName = client ? client.guilds.cache.get(guildId)?.name || null : null;
      logger.debug('Scheduled next spawn successfully', {
        guildId,
        guildName,
        in_ms: delay,
        scheduled_at: scheduledAt,
      });
    } catch (logErr) {
      logger.debug('Scheduled next spawn', { guildId, in_ms: delay, scheduled_at: scheduledAt });
    }
  })().catch((err) => {
    const guildName = getGuildName(guildId);

    if (err instanceof Error) {
      logger.error(`scheduleNext failed (${guildName})`, {
        guildId,
        message: err.message,
        stack: err.stack,
      });
      console.error(`[SPAWN ERROR] Guild ${guildId} (${guildName}): ${err.message}\n${err.stack}`);
    } else if (typeof err === 'object' && err) {
      logger.error(`scheduleNext failed (${guildName})`, { guildId, errorObj: String(err) });
      console.error(`[SPAWN ERROR] Guild ${guildId} (${guildName}):`, err);
    } else {
      logger.error(`scheduleNext failed (${guildName})`, { guildId, error: String(err) });
      console.error(`[SPAWN ERROR] Guild ${guildId} (${guildName}): ${String(err)}`);
    }
  });
}

function requestReschedule(guildId) {
  // If eggs are active, mark for reschedule after they're cleared; otherwise schedule immediately
  const activeMap = activeEggs.get(guildId);
  if (activeMap && activeMap.size > 0) {
    pendingReschedule.add(guildId);
    const guildName = getGuildName(guildId);
    logger.info(`Reschedule requested; will apply after active eggs cleared (${guildName})`, {
      guildId,
    });
    return;
  }
  // schedule immediately
  scheduleNext(guildId);
}

function getNextSpawnForGuild(guildId) {
  // If an active egg event exists, return null to indicate spawn is active now
  const activeMap = activeEggs.get(guildId);
  if (activeMap && activeMap.size > 0)
    return {
      active: true,
      activeSinceMs: Date.now() - (Array.from(activeMap.values())[0].spawnedAt || Date.now()),
      numEggs: Array.from(activeMap.values())[0].numEggs,
    };
  if (nextSpawnAt.has(guildId)) {
    const ts = nextSpawnAt.get(guildId);
    const remaining = Math.max(0, ts - Date.now());
    return {
      active: false,
      scheduledAt: ts,
      remainingMs: remaining,
      pendingReschedule: pendingReschedule.has(guildId),
    };
  }
  return null;
}

function pickEggType() {
  // Weighted random selection from spawnable eggTypes (exclude grantable_only)
  const spawnableEggs = eggTypes.filter((t) => !t.grantable_only);
  const totalWeight = spawnableEggs.reduce((sum, t) => sum + (t.weight || 1), 0);
  let r = Math.random() * totalWeight;
  for (const type of spawnableEggs) {
    r -= type.weight || 1;
    if (r <= 0) return type;
  }
  return spawnableEggs[0]; // fallback
}

async function doSpawn(guildId, forcedEggTypeId, isForced = false) {
  const guildName = getGuildName(guildId);
  // prevent concurrent spawns for the same guild
  if (inProgress.has(guildId)) {
    logger.info(`doSpawn already in progress; skipping (${guildName})`, { guildId });
    return;
  }
  inProgress.add(guildId);
  // clear any enqueued marker now that we're actively processing
  try { enqueuedSet.delete(String(guildId)); } catch (_) {}
  logger.info(`doSpawn entered (${guildName})`, {
    guildId,
    forcedEggTypeId,
    nextSpawnPersisted: nextSpawnAt.get(guildId),
  });
  
  // Aggressive cache cleanup BEFORE spawn to free memory
  try {
    if (client && client.channels && client.channels.cache) {
      const initialSize = client.channels.cache.size;
      client.channels.cache.clear();
      if (initialSize > 0) {
        logger.debug('Cleared Discord.js channel cache before spawn', { initialSize });
      }
    }
  } catch (_) { /* ignore */ }
  // suppress near-duplicate spawns (e.g., timer firing while a force spawn also triggered)
  try {
    const last = lastSpawnAt.get(guildId) || 0;
    const since = Date.now() - last;
    const thresholdMs = 5000; // 5s
    if (!isForced && since >= 0 && since < thresholdMs) {
      logger.warn(`doSpawn suppressed: recent spawn within threshold (${guildName})`, {
        guildId,
        sinceMs: since,
        thresholdMs,
      });
      inProgress.delete(guildId);
      return false;
    }
  } catch (e) {
    try {
      logger &&
        logger.warn &&
        logger.warn('Error checking recent spawn suppression', {
          guildId,
          error: e && (e.stack || e),
        });
    } catch (le) {
      try {
        fallbackLogger.warn(
          'Failed logging recent spawn suppression error',
          le && (le.stack || le)
        );
      } catch (ignored) {
        /* ignore */ void 0;
      }
    }
  }
  try {
    // Clear persisted next_spawn_at so the central schedule no longer shows this as pending
    try {
      nextSpawnAt.delete(guildId);
      try {
        const knex = db.knex;
        await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: null });
        // Remove any queued job for this guild (we are executing now)
        try {
          await knex('spawn_jobs').where({ guild_id: guildId }).del();
        } catch (jm) {
          // ignore migration/table missing errors
        }
      } catch (e) {
        try {
          logger.warn('Failed clearing next_spawn_at or spawn_jobs at doSpawn start', {
            guildId,
            error: e && (e.stack || e),
          });
        } catch (le) {
          try {
            fallbackLogger.warn(
              'Failed logging next_spawn_at/spawn_jobs clear error at doSpawn start',
              le && (le.stack || le)
            );
          } catch (ignored) {
            /* ignore */ void 0;
          }
        }
      }
    } catch (e) {
      try {
        logger.warn('Error clearing next_spawn_at at doSpawn start', { guildId, error: e && (e.stack || e) });
      } catch (le) {
        try {
          fallbackLogger.warn('Failed logging next_spawn_at clear error at doSpawn start', le && (le.stack || le));
        } catch (ignored) {
          /* ignore */ void 0;
        }
      }
    }
    const cfg = await guildModel.getGuildConfig(guildId);
    if (!cfg || !cfg.channel_id) {
      logger.info(`No spawn channel configured; skipping (${guildName})`, { guildId });
      return scheduleNext(guildId);
    }

    // Only one spawn event at a time, but spawn up to egg_limit eggs in this event
    const guildMap = activeEggs.get(guildId);
    if (!isForced && guildMap && guildMap.size > 0) {
      logger.info(`Spawn event already active; skipping (${guildName})`, { guildId });
      return scheduleNext(guildId);
    }
    const limit = (cfg && cfg.egg_limit) || 1;
    const channel = await client.channels.fetch(cfg.channel_id).catch(() => null);
    if (!channel) {
      logger.warn(`Configured channel not found (${guildName})`, {
        guildId,
        channel_id: cfg.channel_id,
      });
      return scheduleNext(guildId);
    }
    const channelPerms =
      channel.permissionsFor && client && client.user ? channel.permissionsFor(client.user) : null;
    const canSendMessages = channelPerms
      ? channelPerms.has(PermissionsBitField.Flags.ViewChannel) &&
        channelPerms.has(PermissionsBitField.Flags.SendMessages)
      : true;
    if (!canSendMessages) {
      const permErr = new Error('Missing ViewChannel/SendMessages permission in spawn channel');
      permErr.code = 403;
      throw permErr;
    }
    // Randomly determine how many eggs to spawn (1 to limit, higher limit increases chance of more)
    let numEggs = 1;
    if (limit > 1) {
      const weights = Array.from({ length: limit }, (_, i) => i + 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          numEggs = i + 1;
          break;
        }
      }
    }
    // Pick egg type
    let eggType;
    if (forcedEggTypeId) {
      eggType = eggTypes.find((e) => e.id === forcedEggTypeId) || pickEggType();
    } else {
      eggType = pickEggType();
    }
    const eggWord = numEggs === 1 ? `${eggType.name} has` : `${numEggs} ${eggType.name}s have`;
    const eggEmoji = eggType.emoji;
    // Attempt to attach the spawn image if available. Ensure the text is always sent.
    const imgPath = path.join(__dirname, '../assets/images/egg_spawn.png');
    const hasImage = fs.existsSync(imgPath);
    // Check attach permissions and file size limits before attempting to attach
    const canAttachFiles = channelPerms
      ? channelPerms.has(PermissionsBitField.Flags.AttachFiles)
      : false;
    let attachment = null;
    if (hasImage && canAttachFiles) {
      try {
        const stats = fs.statSync(imgPath);
        const maxSize = Number(process.env.SPAWN_IMAGE_CACHE_MAX_BYTES) || 8 * 1024 * 1024; // 8MB conservative limit
        if (stats.size <= maxSize) {
          // Use preloaded buffer when available to avoid allocating a new large Buffer each spawn
          try {
            if (!spawnImageBuffer) {
              spawnImageBuffer = fs.readFileSync(imgPath);
            }
            logger.debug('Using spawn image buffer for attachment', { guildId, bufferSize: spawnImageBuffer && spawnImageBuffer.length });
            attachment = { attachment: spawnImageBuffer, name: 'egg_spawn.png' };
          } catch (readErr) {
            logger.warn('Failed reading spawn image into buffer; skipping attach', {
              guildId,
              error: readErr && (readErr.stack || readErr),
            });
            attachment = null;
            spawnImageBuffer = null; // clear cache on read failure
          }
        } else {
          logger.warn('Spawn image too large to attach', { guildId, size: stats.size, maxSize });
        }
      } catch (statErr) {
        logger.warn('Failed to stat spawn image; skipping attach', {
          guildId,
          error: statErr && (statErr.stack || statErr),
        });
      }
    } else if (hasImage && !canAttachFiles) {
      warnWithCooldown(
        `attach:${guildId}`,
        'Bot lacks AttachFiles permission in channel; skipping image attach',
        { guildId, channel: channel.id }
      );
    }
    const message = `${eggWord} spawned! Type \`egg\` to catch ${numEggs === 1 ? 'it' : 'them'}!`;
    const buildSpawnV2Payload = (files = null) => {
      const container = new ContainerBuilder();
      // Display emoji as a prominent element on the container (separate from text)
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${eggEmoji}`));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
      const payload = {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      };
      if (files) payload.files = files;
      return payload;
    };
    let sent;
    const preferLegacy = guildSendMode.get(guildId) === 'legacy';
    try {
      if (preferLegacy) {
        sent = await channel.send({ content: `${eggEmoji} ${message}` });
        if (attachment) {
          try {
            await channel.send({ files: [attachment] });
          } catch (_) {
            /* ignore */ void 0;
          }
        }
      } else if (attachment) {
        // Prefer sending text+image together
        try {
          sent = await channel.send(buildSpawnV2Payload([attachment]));
        } catch (firstErr) {
          // Attempt fallback: use preloaded buffer and resend in one message
          warnWithCooldown(
            `v2-combined:${guildId}`,
            'Combined V2 text+image initial send failed; retrying with buffer',
            { guildId, error: firstErr && (firstErr.stack || firstErr) },
            5 * 60 * 1000
          );
          try {
            if (!spawnImageBuffer) {
              spawnImageBuffer = fs.readFileSync(imgPath);
            }
            logger.debug('Retrying combined V2 send with buffer fallback', { guildId, bufferSize: spawnImageBuffer && spawnImageBuffer.length });
            sent = await channel.send(
              buildSpawnV2Payload([{ attachment: spawnImageBuffer, name: 'egg_spawn.png' }])
            );
          } catch (bufErr) {
            // If buffer fallback also fails, rethrow to outer catch to handle V2-only-then-legacy strategy
            warnWithCooldown(
              `v2-buffer:${guildId}`,
              'Buffer fallback for combined V2 text+image failed',
              { guildId, error: bufErr && (bufErr.stack || bufErr) },
              5 * 60 * 1000
            );
            throw bufErr;
          }
        }
      } else {
        sent = await channel.send(buildSpawnV2Payload());
      }
    } catch (e) {
      // If V2 send ultimately fails, try legacy content and then image separately.
      const guildName = getGuildName(guildId);
      warnWithCooldown(
        `v2-fallback:${guildId}`,
        `V2 spawn send failed; falling back to legacy text/image strategy (${guildName})`,
        { guildId, error: e && (e.stack || e) },
        5 * 60 * 1000
      );
      guildSendMode.set(guildId, 'legacy');
      try {
        sent = await channel.send({ content: `${eggEmoji} ${message}` });
      } catch (textErr) {
        const guildName = getGuildName(guildId);
        logger.error(`Failed sending spawn text (${guildName})`, {
          guildId,
          error: textErr && (textErr.stack || textErr),
        });
        throw textErr;
      }
      if (attachment) {
        try {
          await channel.send({ files: [attachment] });
        } catch (imgErr) {
          logger.warn('Separate attachment send failed; retrying with buffer', {
            guildId,
            error: imgErr && (imgErr.stack || imgErr),
          });
          try {
            if (!spawnImageBuffer) {
              spawnImageBuffer = fs.readFileSync(imgPath);
            }
            await channel.send({ files: [{ attachment: spawnImageBuffer, name: 'egg_spawn.png' }] });
          } catch (imgBufErr) {
            logger.warn('Failed sending spawn image separately (buffer fallback)', {
              guildId,
              error: imgBufErr && (imgBufErr.stack || imgBufErr),
            });
          }
        }
      }
    }
    // Store a single active egg event per guild
    const spawnedAt = Date.now();
    activeEggs.set(
      guildId,
      new Map([
        [sent.id, { messageId: sent.id, channelId: channel.id, spawnedAt, numEggs, eggType }],
      ])
    );
    
    // Log active eggs count for memory tracking
    try {
      const totalActiveEggs = Array.from(activeEggs.values()).reduce((sum, map) => sum + map.size, 0);
      const mu = process.memoryUsage();
      const heapPercent = Math.round((mu.heapUsed / mu.heapTotal) * 100);
      logger.info('[SPAWN] Egg spawned', {
        guildId,
        messageId: sent.id,
        numEggs,
        eggType: eggType.id,
        totalActiveEggs,
        activeGuilds: activeEggs.size,
        heapPercent: `${heapPercent}%`,
      });
    } catch (_) { /* ignore */ }
    
    // Set a cleanup timeout for uncaught eggs (prevent unbounded growth if users never catch them)
    if (uncaughtEggTimeout.has(guildId)) {
      clearTimeout(uncaughtEggTimeout.get(guildId));
    }
    const timeoutId = setTimeout(() => {
      const guildMap = activeEggs.get(guildId);
      if (guildMap && guildMap.size > 0) {
        logger.warn('Cleaning up uncaught eggs after timeout', {
          guildId,
          messageIds: Array.from(guildMap.keys()),
          timeoutMs: UNCAUGHT_EGG_TIMEOUT_MS,
        });
        activeEggs.delete(guildId);
        // Try to delete the message if still accessible
        try {
          for (const eggEvent of guildMap.values()) {
            client.channels.fetch(eggEvent.channelId).then((ch) => {
              ch.messages.fetch(eggEvent.messageId).then((msg) => msg.delete()).catch(() => {});
            }).catch(() => {});
          }
        } catch (_) { /* ignore */ }
      }
      uncaughtEggTimeout.delete(guildId);
    }, UNCAUGHT_EGG_TIMEOUT_MS);
    uncaughtEggTimeout.set(guildId, timeoutId);
    // persist active spawn so it survives restarts
    try {
      const knex = db.knex;
      await knex('active_spawns').insert({
        guild_id: guildId,
        message_id: sent.id,
        channel_id: channel.id,
        spawned_at: spawnedAt,
        num_eggs: numEggs,
        egg_type: eggType.id,
      });
    } catch (e) {
      try {
        logger.warn('Failed persisting active spawn to DB', {
          guildId,
          messageId: sent.id,
          error: e && (e.stack || e),
        });
      } catch (le) {
        try {
          fallbackLogger.warn(
            'Failed logging active spawn persistence error',
            le && (le.stack || le)
          );
        } catch (ignored) {
          /* ignore */ void 0;
        }
      }
    }
    // clear persisted next_spawn_at since this spawn has now occurred
    try {
      const knex = db.knex;
      await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: null });
    } catch (e) {
      try {
        logger.warn('Failed clearing next_spawn_at after spawn', {
          guildId,
          error: e && (e.stack || e),
        });
      } catch (le) {
        try {
          fallbackLogger.warn(
            'Failed logging next_spawn_at clear error after spawn',
            le && (le.stack || le)
          );
        } catch (ignored) {
          /* ignore */ void 0;
        }
      }
    }
    logger.info(`Egg(s) spawned (${guildName})`, {
      guildId,
      channel: channel.id,
      messageId: sent.id,
      numEggs,
      eggType: eggType.id,
    });
    
    // Aggressive cache cleanup AFTER spawn message is sent to free memory
    try {
      if (client && client.channels && client.channels.cache) {
        const initialSize = client.channels.cache.size;
        client.channels.cache.clear();
        if (initialSize > 0) {
          logger.debug('Cleared Discord.js channel cache after spawn', { initialSize });
        }
      }
    } catch (_) { /* ignore */ }
    
    logger.info(`doSpawn leaving (${guildName})`, { guildId, messageId: sent.id, spawnedAt });
    try {
      lastSpawnAt.set(guildId, Date.now());
    } catch (e) {
      try {
        logger &&
          logger.warn &&
          logger.warn('Failed setting lastSpawnAt', { guildId, error: e && (e.stack || e) });
      } catch (le) {
        try {
          fallbackLogger.warn('Failed logging lastSpawnAt set error', le && (le.stack || le));
        } catch (ignored) {
          /* ignore */ void 0;
        }
      }
    }
    // Clear failure tracker on successful spawn
    if (failureTracker.has(guildId)) {
      failureTracker.delete(guildId);
      logger.debug('Cleared spawn failure tracker for guild', { guildId });
    }
    // schedule next spawn after this event is cleared
    return true;
  } catch (err) {
    const guildName = getGuildName(guildId);
    const isRateLimit = isRateLimitError(err);
    const isPermission = isPermissionError(err);
    const errorType = isRateLimit ? 'rate-limit' : isPermission ? 'permission' : 'other';

    if (isPermission) {
      warnWithCooldown(
        `spawn-perm:${guildId}`,
        `Error during doSpawn (${guildName})`,
        { guildId, error: err.stack || err, errorType, code: err.code, status: err.status },
        5 * 60 * 1000
      );
    } else {
      logger.error(`Error during doSpawn (${guildName})`, {
        guildId,
        error: err.stack || err,
        errorType,
        code: err.code,
        status: err.status,
      });
    }

    recordSpawnFailure(guildId);

    // Apply extra backoff for rate limits (wait longer before retry)
    if (isRateLimit) {
      const tracker = failureTracker.get(guildId);
      if (tracker) {
        // Double the failure count for rate limits to increase backoff aggressively
        tracker.count = Math.min(20, tracker.count + 1);
        logger.warn(`Aggressive backoff applied to ${guildName} due to rate limit`, {
          guildId,
          newCount: tracker.count,
        });
      }
    }

    if (isPermission) {
      const tracker = failureTracker.get(guildId);
      if (tracker) {
        tracker.count = Math.min(20, tracker.count + 2);
        logger.warn(`Aggressive backoff applied to ${guildName} due to permissions`, {
          guildId,
          newCount: tracker.count,
        });
      }
    }

    scheduleNext(guildId);
    return false;
  } finally {
    // Aggressive cache cleanup in finally block to ensure it always happens
    try {
      if (client && client.channels && client.channels.cache) {
        const initialSize = client.channels.cache.size;
        if (initialSize > 0) {
          client.channels.cache.clear();
          logger.debug('Cleared Discord.js channel cache in finally block', { initialSize, guildId });
        }
      }
    } catch (_) { /* ignore */ }
    
    inProgress.delete(guildId);
  }
}

async function handleMessage(message) {
  if (!message.guild) return false;
  const gid = message.guild.id;
  const guildMap = activeEggs.get(gid);
  if (!guildMap || guildMap.size === 0) return false;
  if (message.author.bot) return false;
  if (message.content.trim().toLowerCase() !== 'egg') return false;

  // check for a single active egg event in this channel
  const eggsInChannel = [...guildMap.values()].filter((e) => e.channelId === message.channel.id);
  if (eggsInChannel.length === 0) return false;

  // Only the first user to type 'egg' claims all eggs
  const eggEvent = eggsInChannel[0];
  activeEggs.delete(gid);
  
  // Log egg catch and memory state
  try {
    const totalActiveEggs = Array.from(activeEggs.values()).reduce((sum, map) => sum + map.size, 0);
    const mu = process.memoryUsage();
    const heapPercent = Math.round((mu.heapUsed / mu.heapTotal) * 100);
    logger.info('[SPAWN] Eggs caught', {
      guildId: gid,
      user: message.author.id,
      numEggs: eggEvent.numEggs,
      eggType: eggEvent.eggType.id,
      totalActiveEggs,
      activeGuilds: activeEggs.size,
      heapPercent: `${heapPercent}%`,
    });
  } catch (_) { /* ignore */ }
  
  try {
    // Calculate catch time
    const catchTimeMs = Date.now() - eggEvent.spawnedAt;
    // Track per egg type and stats
    const result = await userModel.addEggsForGuild(
      String(message.author.id),
      gid,
      eggEvent.numEggs,
      eggEvent.eggType.id,
      catchTimeMs
    );

    const catchTime = Duration.fromMillis(catchTimeMs)
      .shiftTo('years', 'months', 'days', 'hours', 'minutes', 'seconds')
      .toHuman({ maximumFractionDigits: 2, showZeros: false });

    await message.channel.send(
      `${message.author} caught ${eggEvent.numEggs} ${eggEvent.eggType.emoji} ${eggEvent.eggType.name}${eggEvent.numEggs > 1 ? 's' : ''}! (${catchTime})\n\-# You now have ${result} ${eggEvent.eggType.emoji} ${eggEvent.eggType.name}${result > 1 ? 's' : ''}.`
    );
    logger.info('Egg(s) caught', {
      guildId: gid,
      user: message.author.id,
      numEggs: eggEvent.numEggs,
      eggType: eggEvent.eggType.id,
      catchTimeMs,
    });
  } catch (err) {
    logger.error('Failed awarding egg', {
      guildId: gid,
      user: message.author.id,
      error: err.stack || err,
    });
    await message.channel.send(
      `${emojis.facehugger || ''} Error awarding egg to ${message.author}.`
    );
  }

  // remove persisted active spawn row for this message
  try {
    const knex = db.knex;
    if (eggEvent && eggEvent.messageId)
      await knex('active_spawns').where({ guild_id: gid, message_id: eggEvent.messageId }).del();
  } catch (e) {
    try {
      logger.warn('Failed removing active_spawns row after catch', {
        guildId: gid,
        messageId: eggEvent && eggEvent.messageId,
        error: e && (e.stack || e),
      });
    } catch (le) {
      try {
        fallbackLogger.warn(
          'Failed logging removal of active_spawns row after catch',
          le && (le.stack || le)
        );
      } catch (ignored) {
        /* ignore */ void 0;
      }
    }
  }

  // Optionally delete the original spawn message if configured for this guild
  try {
    const cfg = await guildModel.getGuildConfig(gid);
    const shouldDelete = cfg && cfg.data && cfg.data.delete_spawn_message === true;
    if (shouldDelete && eggEvent && eggEvent.messageId) {
      try {
        // Fetch the channel where the spawn was posted to be safe
        const spawnChannelId = eggEvent.channelId || message.channel.id;
        const spawnChannel = await client.channels.fetch(spawnChannelId).catch(() => null);
        if (spawnChannel) {
          const perms =
            spawnChannel.permissionsFor && client && client.user
              ? spawnChannel.permissionsFor(client.user)
              : null;
          const canManage = perms ? perms.has(PermissionsBitField.Flags.ManageMessages) : false;
          if (!canManage) {
            logger.warn('Bot lacks permission to delete spawn message', {
              guildId: gid,
              channelId: spawnChannelId,
              messageId: eggEvent.messageId,
            });
          } else {
            const spawnMsg = await spawnChannel.messages
              .fetch(eggEvent.messageId)
              .catch(() => null);
            if (spawnMsg) {
              await spawnMsg.delete().catch(() => null);
              logger.info('Deleted spawn message after catch', {
                guildId: gid,
                messageId: eggEvent.messageId,
              });
            } else {
              logger.warn('Spawn message not found when attempting delete', {
                guildId: gid,
                messageId: eggEvent.messageId,
              });
            }
          }
        } else {
          logger.warn('Spawn channel not found when attempting delete', {
            guildId: gid,
            channelId: eggEvent.channelId,
          });
        }
      } catch (delErr) {
        logger.warn('Failed to delete spawn message after catch', {
          guildId: gid,
          messageId: eggEvent && eggEvent.messageId,
          error: delErr && (delErr.stack || delErr),
        });
      }
    }
  } catch (e) {
    try {
      logger.warn('Failed checking spawn deletion setting after catch', {
        guildId: gid,
        error: e && (e.stack || e),
      });
    } catch (le) {
      try {
        fallbackLogger.warn('Failed logging spawn deletion check error', le && (le.stack || le));
      } catch (ignored) {
        /* ignore */ void 0;
      }
    }
  }

  // If no more active eggs, schedule the next spawn (apply pending reschedule if present)
  if (!activeEggs.has(gid)) {
    if (pendingReschedule.has(gid)) {
      pendingReschedule.delete(gid);
    }
    // Clear the uncaught egg timeout since eggs were caught
    if (uncaughtEggTimeout.has(gid)) {
      clearTimeout(uncaughtEggTimeout.get(gid));
      uncaughtEggTimeout.delete(gid);
    }
    // Always schedule the next spawn after an event completes
    try {
      scheduleNext(gid);
    } catch (e) {
      try {
        logger.warn('Failed scheduling next spawn after catch', {
          guildId: gid,
          error: e && (e.stack || e),
        });
      } catch (le) {
        try {
          fallbackLogger.warn(
            'Failed logging scheduleNext error after catch',
            le && (le.stack || le)
          );
        } catch (ignored) {
          /* ignore */ void 0;
        }
      }
    }
  }
  return true;
}

module.exports = {
  init,
  scheduleNext,
  requestReschedule,
  handleMessage,
  activeEggs,
  doSpawn,
  getNextSpawnForGuild,
};

// Force spawn wrapper: cancel any existing timer, run a spawn immediately, then schedule next normally.
async function forceSpawn(guildId, forcedEggTypeId) {
  // clear existing timer to avoid it firing after we spawn now
  try {
    nextSpawnAt.delete(guildId);
    try {
      const knex = db.knex;
      await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: null });
      try {
        await knex('spawn_jobs').where({ guild_id: guildId }).del();
      } catch (_) {
        // ignore missing table or delete errors
      }
    } catch (e) {
      try {
        logger.warn('Failed clearing next_spawn_at or spawn_jobs at forceSpawn start', {
          guildId,
          error: e && (e.stack || e),
        });
      } catch (le) {
        try {
          fallbackLogger.warn(
            'Failed logging next_spawn_at/spawn_jobs clear error at forceSpawn start',
            le && (le.stack || le)
          );
        } catch (ignored) {
          /* ignore */ void 0;
        }
      }
    }
  } catch (e) {
    try {
      logger.warn('Error clearing next_spawn_at in forceSpawn', { guildId, error: e && (e.stack || e) });
    } catch (le) {
      try {
        fallbackLogger.warn(
          'Failed logging next_spawn_at clear error in forceSpawn',
          le && (le.stack || le)
        );
      } catch (ignored) {
        /* ignore */ void 0;
      }
    }
  }
  // If an active spawn exists, clear it so force spawn always restarts the event.
  try {
    const activeMap = activeEggs.get(guildId);
    if (activeMap && activeMap.size > 0) {
      for (const [, eggEvent] of activeMap.entries()) {
        try {
          const channel = await client.channels.fetch(eggEvent.channelId).catch(() => null);
          if (channel && eggEvent.messageId) {
            try {
              const msg = await channel.messages.fetch(eggEvent.messageId).catch(() => null);
              if (msg) await msg.delete().catch(() => null);
            } catch (_) {
              /* ignore */ void 0;
            }
          }
        } catch (_) {
          /* ignore */ void 0;
        }
      }
      activeEggs.delete(guildId);
      try {
        const knex = db.knex;
        await knex('active_spawns').where({ guild_id: guildId }).del();
      } catch (e) {
        try {
          logger.warn('Failed clearing active_spawns rows during force spawn restart', {
            guildId,
            error: e && (e.stack || e),
          });
        } catch (le) {
          try {
            fallbackLogger.warn(
              'Failed logging active_spawns clear error in forceSpawn',
              le && (le.stack || le)
            );
          } catch (ignored) {
            /* ignore */ void 0;
          }
        }
      }
      const guildName = getGuildName(guildId);
      logger.info(`Cleared active spawn event before force spawn restart (${guildName})`, {
        guildId,
      });
    }
  } catch (e) {
    try {
      logger.warn('Failed clearing active spawn event before force spawn', {
        guildId,
        error: e && (e.stack || e),
      });
    } catch (le) {
      try {
        fallbackLogger.warn(
          'Failed logging active spawn clear failure before force spawn',
          le && (le.stack || le)
        );
      } catch (ignored) {
        /* ignore */ void 0;
      }
    }
  }
  try {
    // Clear timers so the forced spawn runs without racing scheduled timers.
    // Do not set lastSpawnAt preemptively; let doSpawn set it if a spawn actually happens.
    const spawned = await enqueueSpawn(guildId, forcedEggTypeId, true);
    return spawned;
  } finally {
    // After forced spawn, schedule the next spawn normally
    try {
      scheduleNext(guildId);
    } catch (e) {
      try {
        logger.warn('Failed scheduling next spawn after forceSpawn', {
          guildId,
          error: e && (e.stack || e),
        });
      } catch (le) {
        try {
          fallbackLogger.warn(
            'Failed logging scheduleNext error after forceSpawn',
            le && (le.stack || le)
          );
        } catch (ignored) {
          /* ignore */ void 0;
        }
      }
    }
  }
}

module.exports.forceSpawn = forceSpawn;

// Shutdown helper: clear any pending timers used for scheduling
async function shutdown() {
  shuttingDown = true;
  try {
    // stop central poller and clear any previous per-guild timers
    try { stopPoller(); } catch (_) {}
    for (const [, t] of timers.entries()) {
      try { clearTimeout(t); } catch (_) {}
    }
    timers.clear();
    pendingReschedule.clear();
    inProgress.clear();
    failureTracker.clear();
    guildSendMode.clear();
    warnCooldowns.clear();
    while (spawnQueue.length > 0) {
      const task = spawnQueue.shift();
      if (task && typeof task.reject === 'function') {
        task.reject(new Error('spawnManager shutdown: cancelled pending spawn task'));
      }
    }
    logger.info('spawnManager shutdown: cleared timers and pending state');
  } catch (e) {
    logger.warn('spawnManager shutdown error', { error: e && (e.stack || e) });
  }
}

module.exports.shutdown = shutdown;
