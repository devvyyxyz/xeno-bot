const utils = require('../utils');
const logger = utils.logger.get('guildJoinWorker');
const guildJoinLib = require('../lib/guildJoin');

let client = null;
let queue = [];
let active = 0;
const concurrency = Math.max(1, Number(process.env.GUILD_JOIN_WORKER_CONCURRENCY) || 2);

// Batching/debounce: buffer incoming join requests for a short window and flush together
const batchWindowMs = Math.max(0, Number(process.env.GUILD_JOIN_BATCH_MS) || 30000);
let batchTimer = null;
// bufferedJobs: guildId -> array of { resolve, reject }
const bufferedJobs = new Map();

function enqueueGuildJoin(job) {
  // If batching is disabled (0), push directly to queue
  if (!batchWindowMs) {
    return new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      processQueue();
    });
  }

  return new Promise((resolve, reject) => {
    const gid = String(job.guildId);
    const arr = bufferedJobs.get(gid) || [];
    arr.push({ resolve, reject });
    bufferedJobs.set(gid, arr);

    // start or reset batch timer
    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        flushBufferedJobs();
      }, batchWindowMs);
      if (typeof batchTimer.unref === 'function') batchTimer.unref();
    }
  });
}

function flushBufferedJobs() {
  batchTimer = null;
  const guildIds = Array.from(bufferedJobs.keys());
  if (!guildIds.length) return;
  for (const gid of guildIds) {
    const waiters = bufferedJobs.get(gid) || [];
    bufferedJobs.delete(gid);
    // For each buffered guild, enqueue a single job instance and wire up all waiters to its promise
    const job = { guildId: gid };
    const promise = new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
    });
    // When the job completes, resolve/reject all waiters
    promise.then((res) => {
      for (const w of waiters) {
        try { w.resolve(res); } catch (_) { /* ignore */ }
      }
    }).catch((err) => {
      for (const w of waiters) {
        try { w.reject(err); } catch (_) { /* ignore */ }
      }
    });
  }
  processQueue();
}

function processQueue() {
  while (active < concurrency && queue.length > 0) {
    const item = queue.shift();
    active += 1;
    processJob(item.job)
      .then((res) => item.resolve(res))
      .catch((err) => item.reject(err))
      .finally(() => {
        active -= 1;
        setImmediate(processQueue);
      });
  }
}

async function processJob({ guildId }) {
  try {
    if (!client) throw new Error('guildJoinWorker not initialized with client');
    let guild = client.guilds.cache.get(guildId) || null;
    if (!guild) {
      try {
        guild = await client.guilds.fetch(guildId).catch(() => null);
      } catch (_) { guild = null; }
    }
    if (!guild) {
      logger.warn('Guild not available when processing join job', { guildId });
      return { ok: false, reason: 'guild_not_found' };
    }

    // Send webhook notification (non-blocking from caller; worker handles retries)
    try {
      await guildJoinLib.sendGuildJoinV2Webhook({ guild, client });
    } catch (e) {
      logger.warn('Guild join webhook failed in worker', { guildId, error: e && (e.stack || e) });
    }

    // Build a light welcome embed and attempt to post it to a sendable channel or DM owner
    try {
      const avatarUrl = client.user ? client.user.displayAvatarURL() : undefined;
      const helpMention = await guildJoinLib.findHelpMention(client, guild.id);
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`Thanks for inviting ${client.user ? client.user.username : 'the bot'}!`)
        .setDescription(`I'm ready to help. Use ${helpMention} to see available commands and setup instructions.`)
        .setColor(0x5865F2)
        .setThumbnail(avatarUrl)
        .setTimestamp()
        .setFooter({ text: 'Xeno Bot', iconURL: avatarUrl });

      const trySendToChannel = async (channel) => {
        try {
          await channel.send({ embeds: [embed] });
          logger.info('Sent join embed to channel (worker)', { guildId, channelId: channel.id });
          return true;
        } catch (err) {
          logger.warn('Failed sending join embed to channel (worker)', { guildId, channelId: channel.id, error: err && (err.stack || err) });
          return false;
        }
      };

      // Try system channel
      try {
        const sys = guild.systemChannel;
        if (sys && sys.permissionsFor(client.user) && sys.permissionsFor(client.user).has('SendMessages')) {
          const ok = await trySendToChannel(sys);
          if (ok) return { ok: true };
        }
      } catch (e) { logger.warn('System channel check failed in worker', { guildId, error: e && (e.stack || e) }); }

      // Fallback: first sendable channel
      try {
        const sendable = guild.channels.cache
          .filter(c => c && typeof c.permissionsFor === 'function')
          .filter(c => c.permissionsFor(client.user) && c.permissionsFor(client.user).has('SendMessages'))
          .sort((a, b) => (a.position || 0) - (b.position || 0));
        if (sendable && sendable.size > 0) {
          const first = sendable.first();
          const ok = await trySendToChannel(first);
          if (ok) return { ok: true };
        }
      } catch (e) { logger.warn('Failed scanning channels for sendable channel in worker', { guildId, error: e && (e.stack || e) }); }

      // DM owner as last resort
      try {
        const owner = await guild.fetchOwner();
        if (owner) {
          try {
            await owner.send({ embeds: [embed] });
            logger.info('Sent DM to guild owner after join (worker)', { guildId, ownerId: owner.id });
            return { ok: true };
          } catch (dmErr) {
            logger.warn('Failed to DM guild owner after join (worker)', { guildId, ownerId: owner.id, error: dmErr && (dmErr.stack || dmErr) });
          }
        }
      } catch (e) { logger.warn('Failed fetching guild owner to DM after join (worker)', { guildId, error: e && (e.stack || e) }); }
    } catch (e) {
      logger.warn('Worker failed to send welcome embed/DM', { guildId, error: e && (e.stack || e) });
    }

    return { ok: true };
  } catch (err) {
    logger.error('Unhandled error processing guild join job', { guildId: (err && err.guildId) || null, error: err && (err.stack || err) });
    throw err;
  }
}

function init(botClient) {
  client = botClient;
  logger.info('guildJoinWorker initialized', { concurrency });
}

module.exports = { init, enqueueGuildJoin };
