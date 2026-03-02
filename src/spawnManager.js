const guildModel = require('./models/guild');
const userModel = require('./models/user');
const logger = require('./utils/logger').get('spawn');
const fallbackLogger = require('./utils/fallbackLogger');
const emojis = require('../config/emojis.json');
const eggTypes = require('../config/eggTypes.json');
const path = require('path');
const fs = require('fs');
const { AttachmentBuilder, PermissionsBitField, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const db = require('./db');

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
    logger.debug && logger.debug('getGuildName: guild not in cache', { guildId, cacheSize: client.guilds.cache.size });
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
const pendingReschedule = new Set();
// nextSpawnAt: guildId -> timestamp (ms since epoch) when the next spawn is scheduled
let nextSpawnAt = new Map();
// inProgress: guildId set to prevent concurrent doSpawn runs
let inProgress = new Set();
// lastSpawnAt: guildId -> timestamp of last completed spawn, used to suppress near-duplicate spawns
let lastSpawnAt = new Map();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function init(botClient) {
  client = botClient;
  // start schedules for all guilds that have settings
  try {
    const knex = db.knex;
    const rows = await knex('guild_settings').select('*');
    // restore any active spawns from DB
    try {
    const activeRows = await knex('active_spawns').select('*');
      for (const r of activeRows) {
        try {
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
          // Basic validation: message should have been posted by the bot and the timestamp should
          // roughly match the persisted spawned_at value. If not, cleanup the row to avoid
          // incorrectly restoring stale or unrelated messages as active spawns.
          try {
            const spawnedAtNum = Number(r.spawned_at) || 0;
            const ageMismatchMs = Math.abs((msg.createdTimestamp || 0) - spawnedAtNum);
            const maxMismatch = 1000 * 60 * 60; // 1 hour tolerance
            if (msg.author?.id !== client.user?.id || ageMismatchMs > maxMismatch) {
              logger.info('Cleaned up stale active spawn (message validation failed)', { messageId: r.message_id, channelId: r.channel_id, ageMismatchMs });
              await knex('active_spawns').where({ id: r.id }).del();
              continue;
            }
          } catch (valErr) {
            try {
              logger.warn('Error validating restored active spawn; removing row', { row: r, error: valErr && (valErr.stack || valErr) });
            } catch (le) {
              try { require('./utils/logger').get('spawn').warn('Failed logging validation error restoring active spawn', { error: le && (le.stack || le) }); } catch (lle) { fallbackLogger.warn('Failed logging validation error restoring active spawn fallback', lle && (lle.stack || lle)); }
            }
            await knex('active_spawns').where({ id: r.id }).del();
            continue;
          }
          const guildMap = activeEggs.get(r.guild_id) || new Map();
          // restore full eggType metadata when possible
          const restoredEggType = (eggTypes.find(t => t.id === r.egg_type) || { id: r.egg_type });
          guildMap.set(r.message_id, { messageId: r.message_id, channelId: r.channel_id, spawnedAt: Number(r.spawned_at), numEggs: r.num_eggs, eggType: restoredEggType });
          activeEggs.set(r.guild_id, guildMap);
        } catch (e) {
          try { logger.warn('Failed restoring active spawn row', { row: r, error: e && (e.stack || e) }); } catch (le) { try { require('./utils/logger').get('spawn').warn('Failed logging restore active spawn error', { error: le && (le.stack || le) }); } catch (lle) { fallbackLogger.warn('Failed logging restore active spawn error fallback', lle && (lle.stack || lle)); } }
        }
      }
    } catch (e) {
      try { logger.warn('Failed loading active_spawns table', { error: e && (e.stack || e) }); } catch (le) { try { require('./utils/logger').get('spawn').warn('Failed logging active_spawns load error', { error: le && (le.stack || le) }); } catch (lle) { fallbackLogger.warn('Failed logging active_spawns load error fallback', lle && (lle.stack || lle)); } }
    }

    for (const row of rows) {
      // if there's a persisted next_spawn_at, respect it; otherwise schedule normally
      if (row.next_spawn_at) {
        const ts = Number(row.next_spawn_at);
        const remaining = Math.max(0, ts - Date.now());
        if (remaining > 0) {
          const t = setTimeout(() => doSpawn(row.guild_id).catch(err => logger.error('Spawn error', { guildId: row.guild_id, error: err.stack || err })), remaining);
          timers.set(row.guild_id, t);
          nextSpawnAt.set(row.guild_id, ts);
          logger.debug('Restored scheduled spawn from DB', { guildId: row.guild_id, scheduled_at: ts, in_ms: remaining });
          continue;
        }
      }
      scheduleNext(row.guild_id);
    }
    logger.info('Spawn manager initialized', { guilds: rows.length });
  } catch (err) {
    logger.error('Failed initializing spawn manager', { error: err.stack || err });
  }
}

function scheduleNext(guildId) {
  // clear existing timer
  if (timers.has(guildId)) {
    clearTimeout(timers.get(guildId));
  }
  (async () => {
    // If there are active eggs and a reschedule was requested, wait until cleared
    const activeMap = activeEggs.get(guildId);
    if (activeMap && activeMap.size > 0) {
      logger.info('Active eggs present; delaying schedule until cleared', { guildId, active: activeMap.size });
      pendingReschedule.add(guildId);
      return;
    }
    const cfg = await guildModel.getGuildConfig(guildId);
    const min = (cfg && cfg.spawn_min_seconds) || 60;
    const max = (cfg && cfg.spawn_max_seconds) || 3600;
    const delay = randomInt(min, max) * 1000;
    const scheduledAt = Date.now() + delay;
    try {
      const guildName = client ? (client.guilds.cache.get(guildId)?.name || null) : null;
      logger.debug('About to schedule next spawn', { guildId, guildName, min, max, delay, scheduledAt, pendingReschedule: pendingReschedule.has(guildId), existingTimer: timers.has(guildId), persistedNext: (await (async () => { try { const k = db.knex; const row = await k('guild_settings').where({ guild_id: guildId }).first('next_spawn_at'); return row && row.next_spawn_at; } catch (e) { return null; } })()) });
    } catch (e) {
      logger.debug('About to schedule next spawn', { guildId, min, max, delay, scheduledAt });
    }
    const t = setTimeout(() => doSpawn(guildId).catch(err => {
      const guildName = getGuildName(guildId);
      logger.error(`Spawn error (${guildName})`, { guildId, error: err.stack || err });
    }), delay);
    timers.set(guildId, t);
    nextSpawnAt.set(guildId, scheduledAt);
    // persist scheduled time to DB so it survives restarts
    try {
      const knex = db.knex;
      await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: scheduledAt });
    } catch (e) {
      try { logger.warn('Failed persisting next_spawn_at to DB', { guildId, error: e && (e.stack || e) }); } catch (le) { try { require('./utils/logger').get('spawn').warn('Failed logging next_spawn_at persistence error', { error: le && (le.stack || le) }); } catch (lle) { fallbackLogger.warn('Failed logging next_spawn_at persistence error fallback', lle && (lle.stack || lle)); } }
    }
    try {
      const guildName = client ? (client.guilds.cache.get(guildId)?.name || null) : null;
      logger.debug('Scheduled next spawn', { guildId, guildName, in_ms: delay, scheduled_at: scheduledAt });
    } catch (e) {
      logger.debug('Scheduled next spawn', { guildId, in_ms: delay, scheduled_at: scheduledAt });
    }
  })();
}

function requestReschedule(guildId) {
  // If eggs are active, mark for reschedule after they're cleared; otherwise schedule immediately
  const activeMap = activeEggs.get(guildId);
  if (activeMap && activeMap.size > 0) {
    pendingReschedule.add(guildId);
    const guildName = getGuildName(guildId);
    logger.info(`Reschedule requested; will apply after active eggs cleared (${guildName})`, { guildId });
    return;
  }
  // schedule immediately
  scheduleNext(guildId);
}

function getNextSpawnForGuild(guildId) {
  // If an active egg event exists, return null to indicate spawn is active now
  const activeMap = activeEggs.get(guildId);
  if (activeMap && activeMap.size > 0) return { active: true, activeSinceMs: Date.now() - (Array.from(activeMap.values())[0].spawnedAt || Date.now()), numEggs: Array.from(activeMap.values())[0].numEggs };
  if (nextSpawnAt.has(guildId)) {
    const ts = nextSpawnAt.get(guildId);
    const remaining = Math.max(0, ts - Date.now());
    return { active: false, scheduledAt: ts, remainingMs: remaining, pendingReschedule: pendingReschedule.has(guildId) };
  }
  return null;
}

function pickEggType() {
  // Weighted random selection from eggTypes config
  const totalWeight = eggTypes.reduce((sum, t) => sum + (t.weight || 1), 0);
  let r = Math.random() * totalWeight;
  for (const type of eggTypes) {
    r -= type.weight || 1;
    if (r <= 0) return type;
  }
  return eggTypes[0]; // fallback
}

async function doSpawn(guildId, forcedEggTypeId, isForced = false) {
  const guildName = getGuildName(guildId);
  // prevent concurrent spawns for the same guild
  if (inProgress.has(guildId)) {
    logger.info(`doSpawn already in progress; skipping (${guildName})`, { guildId });
    return;
  }
  inProgress.add(guildId);
  logger.info(`doSpawn entered (${guildName})`, { guildId, forcedEggTypeId, timersHas: timers.has(guildId), nextSpawnPersisted: nextSpawnAt.get(guildId) });
  // suppress near-duplicate spawns (e.g., timer firing while a force spawn also triggered)
  try {
    const last = lastSpawnAt.get(guildId) || 0;
    const since = Date.now() - last;
    const thresholdMs = 5000; // 5s
      if (!isForced && since >= 0 && since < thresholdMs) {
        logger.warn(`doSpawn suppressed: recent spawn within threshold (${guildName})`, { guildId, sinceMs: since, thresholdMs });
        inProgress.delete(guildId);
        return false;
      }
  } catch (e) {
    try { logger && logger.warn && logger.warn('Error checking recent spawn suppression', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging recent spawn suppression error', le && (le.stack || le)); } catch (ignored) {} }
  }
  try {
    // Clear any existing scheduled timer to avoid duplicate spawns
      try {
        if (timers.has(guildId)) {
          clearTimeout(timers.get(guildId));
          timers.delete(guildId);
        }
        nextSpawnAt.delete(guildId);
        try { const knex = db.knex; await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: null }); } catch (e) { try { logger.warn('Failed clearing next_spawn_at at doSpawn start', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging next_spawn_at clear error at doSpawn start', le && (le.stack || le)); } catch (ignored) {} } }
    } catch (e) {
      try { logger.warn('Error clearing existing spawn timer at doSpawn start', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging error clearing existing spawn timer', le && (le.stack || le)); } catch (ignored) {} }
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
      logger.warn(`Configured channel not found (${guildName})`, { guildId, channel_id: cfg.channel_id });
      return scheduleNext(guildId);
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
      eggType = eggTypes.find(e => e.id === forcedEggTypeId) || pickEggType();
    } else {
      eggType = pickEggType();
    }
    const eggWord = numEggs === 1
      ? `${eggType.name} has`
      : `${numEggs} ${eggType.name}s have`;
    const eggEmoji = eggType.emoji;
    // Attempt to attach the spawn image if available. Ensure the text is always sent.
    const imgPath = path.join(__dirname, '../assets/images/egg_spawn.png');
    const hasImage = fs.existsSync(imgPath);
    // Check attach permissions and file size limits before attempting to attach
    const canAttachFiles = channel.permissionsFor && client && client.user
      ? channel.permissionsFor(client.user)?.has(PermissionsBitField.Flags.AttachFiles)
      : false;
    let attachment = null;
    if (hasImage && canAttachFiles) {
      try {
        const stats = fs.statSync(imgPath);
        const maxSize = 8 * 1024 * 1024; // 8MB conservative limit for many guilds
          if (stats.size <= maxSize) {
          // Read into buffer and attach from memory — send buffer form directly to avoid AttachmentBuilder/path issues
          try {
            const buf = fs.readFileSync(imgPath);
            // Use raw buffer attachment format which is more consistent across environments
            attachment = { attachment: buf, name: 'egg_spawn.png' };
          } catch (readErr) {
            logger.warn('Failed reading spawn image into buffer; skipping attach', { guildId, error: readErr && (readErr.stack || readErr) });
            attachment = null;
          }
        } else {
          logger.warn('Spawn image too large to attach', { guildId, size: stats.size, maxSize });
        }
      } catch (statErr) {
        logger.warn('Failed to stat spawn image; skipping attach', { guildId, error: statErr && (statErr.stack || statErr) });
      }
    } else if (hasImage && !canAttachFiles) {
      logger.warn('Bot lacks AttachFiles permission in channel; skipping image attach', { guildId, channel: channel.id });
    }
    const message = `${eggWord} spawned! Type \`egg\` to catch ${numEggs === 1 ? 'it' : 'them'}!`;
    const buildSpawnV2Payload = (files = null) => {
      const container = new ContainerBuilder();
      // Display emoji as a prominent element on the container (separate from text)
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${eggEmoji}`)
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(message)
      );
      const payload = {
        components: [container],
        flags: MessageFlags.IsComponentsV2
      };
      if (files) payload.files = files;
      return payload;
    };
    let sent;
    try {
      if (attachment) {
        // Prefer sending text+image together
        try {
          sent = await channel.send(buildSpawnV2Payload([attachment]));
        } catch (firstErr) {
          // Attempt fallback: read file into buffer and resend in one message
          logger.warn('Combined V2 text+image initial send failed; retrying with buffer', { guildId, error: firstErr && (firstErr.stack || firstErr) });
          try {
            const buf = fs.readFileSync(imgPath);
            sent = await channel.send(buildSpawnV2Payload([{ attachment: buf, name: 'egg_spawn.png' }]));
          } catch (bufErr) {
            // If buffer fallback also fails, rethrow to outer catch to handle V2-only-then-legacy strategy
            logger.warn('Buffer fallback for combined V2 text+image failed', { guildId, error: bufErr && (bufErr.stack || bufErr) });
            throw bufErr;
          }
        }
      } else {
        sent = await channel.send(buildSpawnV2Payload());
      }
    } catch (e) {
      // If V2 send ultimately fails, try legacy content and then image separately.
      const guildName = getGuildName(guildId);
      logger.warn(`V2 spawn send failed; falling back to legacy text/image strategy (${guildName})`, { guildId, error: e && (e.stack || e) });
      try {
        sent = await channel.send({ content: `${eggEmoji} ${message}` });
      } catch (textErr) {
        const guildName = getGuildName(guildId);
        logger.error(`Failed sending spawn text (${guildName})`, { guildId, error: textErr && (textErr.stack || textErr) });
        throw textErr;
      }
      if (attachment) {
        try {
          await channel.send({ files: [attachment] });
        } catch (imgErr) {
          logger.warn('Separate attachment send failed; retrying with buffer', { guildId, error: imgErr && (imgErr.stack || imgErr) });
          try {
            const buf = fs.readFileSync(imgPath);
            await channel.send({ files: [{ attachment: buf, name: 'egg_spawn.png' }] });
          } catch (imgBufErr) {
            logger.warn('Failed sending spawn image separately (buffer fallback)', { guildId, error: imgBufErr && (imgBufErr.stack || imgBufErr) });
          }
        }
      }
    }
    // Store a single active egg event per guild
    const spawnedAt = Date.now();
    activeEggs.set(guildId, new Map([[sent.id, { messageId: sent.id, channelId: channel.id, spawnedAt, numEggs, eggType }]]));
    // persist active spawn so it survives restarts
    try {
      const knex = db.knex;
      await knex('active_spawns').insert({ guild_id: guildId, message_id: sent.id, channel_id: channel.id, spawned_at: spawnedAt, num_eggs: numEggs, egg_type: eggType.id });
    } catch (e) {
      try { logger.warn('Failed persisting active spawn to DB', { guildId, messageId: sent.id, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging active spawn persistence error', le && (le.stack || le)); } catch (ignored) {} }
    }
    // clear persisted next_spawn_at since this spawn has now occurred
    try { const knex = db.knex; await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: null }); } catch (e) { try { logger.warn('Failed clearing next_spawn_at after spawn', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging next_spawn_at clear error after spawn', le && (le.stack || le)); } catch (ignored) {} } }
    logger.info(`Egg(s) spawned (${guildName})`, { guildId, channel: channel.id, messageId: sent.id, numEggs, eggType: eggType.id });
    logger.info(`doSpawn leaving (${guildName})`, { guildId, messageId: sent.id, spawnedAt });
    try { lastSpawnAt.set(guildId, Date.now()); } catch (e) { try { logger && logger.warn && logger.warn('Failed setting lastSpawnAt', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging lastSpawnAt set error', le && (le.stack || le)); } catch (ignored) {} } }
    // schedule next spawn after this event is cleared
    return true;
  } catch (err) {
    const guildName = getGuildName(guildId);
    logger.error(`Error during doSpawn (${guildName})`, { guildId, error: err.stack || err });
    scheduleNext(guildId);
    return false;
  }
  finally {
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
  const eggsInChannel = [...guildMap.values()].filter(e => e.channelId === message.channel.id);
  if (eggsInChannel.length === 0) return false;

  // Only the first user to type 'egg' claims all eggs
  const eggEvent = eggsInChannel[0];
  activeEggs.delete(gid);
  try {
    // Calculate catch time
    const catchTimeMs = Date.now() - eggEvent.spawnedAt;
    // Track per egg type and stats
    const result = await userModel.addEggsForGuild(String(message.author.id), gid, eggEvent.numEggs, eggEvent.eggType.id, catchTimeMs);
    const catchTimeSec = (catchTimeMs / 1000).toFixed(2);
    await message.channel.send(`${message.author} caught ${eggEvent.numEggs} ${eggEvent.eggType.emoji} ${eggEvent.eggType.name}${eggEvent.numEggs > 1 ? 's' : ''}! (${catchTimeSec}s)\n\-\# You now have ${result} ${eggEvent.eggType.emoji} ${eggEvent.eggType.name}${result > 1 ? 's' : ''}.`);
    logger.info('Egg(s) caught', { guildId: gid, user: message.author.id, numEggs: eggEvent.numEggs, eggType: eggEvent.eggType.id, catchTimeMs });
  } catch (err) {
    logger.error('Failed awarding egg', { guildId: gid, user: message.author.id, error: err.stack || err });
    await message.channel.send(`${emojis.facehugger || ''} Error awarding egg to ${message.author}.`);
  }

  // remove persisted active spawn row for this message
  try {
    const knex = db.knex;
    if (eggEvent && eggEvent.messageId) await knex('active_spawns').where({ guild_id: gid, message_id: eggEvent.messageId }).del();
  } catch (e) {
    try { logger.warn('Failed removing active_spawns row after catch', { guildId: gid, messageId: eggEvent && eggEvent.messageId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging removal of active_spawns row after catch', le && (le.stack || le)); } catch (ignored) {} }
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
          const perms = spawnChannel.permissionsFor && client && client.user ? spawnChannel.permissionsFor(client.user) : null;
          const canManage = perms ? perms.has(PermissionsBitField.Flags.ManageMessages) : false;
          if (!canManage) {
            logger.warn('Bot lacks permission to delete spawn message', { guildId: gid, channelId: spawnChannelId, messageId: eggEvent.messageId });
          } else {
            const spawnMsg = await spawnChannel.messages.fetch(eggEvent.messageId).catch(() => null);
            if (spawnMsg) {
              await spawnMsg.delete().catch(() => null);
              logger.info('Deleted spawn message after catch', { guildId: gid, messageId: eggEvent.messageId });
            } else {
              logger.warn('Spawn message not found when attempting delete', { guildId: gid, messageId: eggEvent.messageId });
            }
          }
        } else {
          logger.warn('Spawn channel not found when attempting delete', { guildId: gid, channelId: eggEvent.channelId });
        }
      } catch (delErr) {
        logger.warn('Failed to delete spawn message after catch', { guildId: gid, messageId: eggEvent && eggEvent.messageId, error: delErr && (delErr.stack || delErr) });
      }
    }
  } catch (e) {
    try { logger.warn('Failed checking spawn deletion setting after catch', { guildId: gid, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging spawn deletion check error', le && (le.stack || le)); } catch (ignored) {} }
  }

  // If no more active eggs, schedule the next spawn (apply pending reschedule if present)
  if (!activeEggs.has(gid)) {
    if (pendingReschedule.has(gid)) {
      pendingReschedule.delete(gid);
    }
    // Always schedule the next spawn after an event completes
    try {
      scheduleNext(gid);
    } catch (e) {
      try { logger.warn('Failed scheduling next spawn after catch', { guildId: gid, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging scheduleNext error after catch', le && (le.stack || le)); } catch (ignored) {} }
    }
  }
  return true;
}

module.exports = { init, scheduleNext, requestReschedule, handleMessage, activeEggs, doSpawn, getNextSpawnForGuild };

// Force spawn wrapper: cancel any existing timer, run a spawn immediately, then schedule next normally.
async function forceSpawn(guildId, forcedEggTypeId) {
  // clear existing timer to avoid it firing after we spawn now
  try {
    if (timers.has(guildId)) {
      clearTimeout(timers.get(guildId));
      timers.delete(guildId);
    }
    nextSpawnAt.delete(guildId);
    try { const knex = db.knex; await knex('guild_settings').where({ guild_id: guildId }).update({ next_spawn_at: null }); } catch (e) { try { logger.warn('Failed clearing next_spawn_at at forceSpawn start', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging next_spawn_at clear error at forceSpawn start', le && (le.stack || le)); } catch (ignored) {} } }
  } catch (e) {
    try { logger.warn('Error clearing timer in forceSpawn', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging error clearing timer in forceSpawn', le && (le.stack || le)); } catch (ignored) {} }
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
            } catch (_) {}
          }
        } catch (_) {}
      }
      activeEggs.delete(guildId);
      try {
        const knex = db.knex;
        await knex('active_spawns').where({ guild_id: guildId }).del();
      } catch (e) {
        try { logger.warn('Failed clearing active_spawns rows during force spawn restart', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging active_spawns clear error in forceSpawn', le && (le.stack || le)); } catch (ignored) {} }
      }
      const guildName = getGuildName(guildId);
      logger.info(`Cleared active spawn event before force spawn restart (${guildName})`, { guildId });
    }
  } catch (e) {
    try { logger.warn('Failed clearing active spawn event before force spawn', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging active spawn clear failure before force spawn', le && (le.stack || le)); } catch (ignored) {} }
  }
  try {
    // Clear timers so the forced spawn runs without racing scheduled timers.
    // Do not set lastSpawnAt preemptively; let doSpawn set it if a spawn actually happens.
    const spawned = await doSpawn(guildId, forcedEggTypeId, true);
    return spawned;
  } finally {
    // After forced spawn, schedule the next spawn normally
    try { scheduleNext(guildId); } catch (e) { try { logger.warn('Failed scheduling next spawn after forceSpawn', { guildId, error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging scheduleNext error after forceSpawn', le && (le.stack || le)); } catch (ignored) {} } }
  }
}

module.exports.forceSpawn = forceSpawn;

// Shutdown helper: clear any pending timers used for scheduling
async function shutdown() {
  try {
    for (const [gid, t] of timers.entries()) {
      try { clearTimeout(t); } catch (e) { try { logger && logger.warn && logger.warn('Failed clearing spawn timer during shutdown', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging timer clear error during spawnManager shutdown', le && (le.stack || le)); } catch (ignored) {} } }
    }
    timers.clear();
    pendingReschedule.clear();
    inProgress.clear();
    logger.info('spawnManager shutdown: cleared timers and pending state');
  } catch (e) {
    logger.warn('spawnManager shutdown error', { error: e && (e.stack || e) });
  }
}

module.exports.shutdown = shutdown;
