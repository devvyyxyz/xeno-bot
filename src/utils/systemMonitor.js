const { EmbedBuilder } = require('discord.js');
const baseLogger = require('./logger');
const logger = baseLogger.get('systemMonitor');

const fs = require('fs');
const path = require('path');
let clientRef = null;
let channelId = null;
let statusMessageId = null;
const systems = {};
const SHUTDOWN_HOOK_TIMEOUT_MS = Number(process.env.SHUTDOWN_HOOK_TIMEOUT_MS) || 5000;
const PERSIST_PATH = path.join(__dirname, '..', '..', 'data', 'system-monitor.json');
let statusUpdateTimer = null;
let statusUpdateInFlight = null;
const monitorStartedAt = Date.now();

// Load persisted state (statusMessageId) early so restarts reuse the same message
loadPersist();
logger.section('System Monitor');
logger.info('systemMonitor loaded persisted state', { statusMessageId });

function loadPersist() {
  try {
    if (fs.existsSync(PERSIST_PATH)) {
      const raw = fs.readFileSync(PERSIST_PATH, 'utf8');
      const obj = JSON.parse(raw || '{}');
      if (obj && obj.statusMessageId) statusMessageId = obj.statusMessageId;
    }
  } catch (e) { logger.warn('Failed loading system monitor persist', { error: e && (e.stack || e) }); }
}

function persist() {
  try {
    const dir = path.dirname(PERSIST_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PERSIST_PATH, JSON.stringify({ statusMessageId: statusMessageId || null }, null, 2), 'utf8');
  } catch (e) { logger.warn('Failed persisting system monitor state', { error: e && (e.stack || e) }); }
}

function overallStatus() {
  const values = Object.values(systems);
  if (!values.length) return { state: 'green', text: 'All Systems Operational' };
  const anyDown = values.some(s => s.status === 'down');
  const anyDegraded = values.some(s => s.status === 'degraded');
  if (anyDown) return { state: 'red', text: 'Some Systems Down' };
  if (anyDegraded) return { state: 'orange', text: 'Some Systems Degraded' };
  return { state: 'green', text: 'All Systems Operational' };
}

function statusEmoji(s) {
  if (s === 'green') return '🟢';
  if (s === 'orange') return '🟠';
  return '🔴';
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function compactReason(reason, maxLen = 80) {
  if (!reason) return '';
  const normalized = String(reason).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function buildSystemLines() {
  const keys = Object.keys(systems);
  if (!keys.length) return ['- No monitored systems registered'];

  return keys.map((k) => {
    const s = systems[k] || {};
    const status = s.status || 'unknown';
    const icon = status === 'up' ? '🟢' : status === 'degraded' ? '🟠' : '🔴';
    const name = s.name || k;
    const reason = compactReason(s.reason);
    return reason ? `${icon} **${name}** - ${reason}` : `${icon} **${name}**`;
  });
}

function buildStatusEmbed() {
  const ov = overallStatus();
  const keys = Object.keys(systems);
  const upCount = keys.filter((k) => systems[k] && systems[k].status === 'up').length;
  const degradedCount = keys.filter((k) => systems[k] && systems[k].status === 'degraded').length;
  const downCount = keys.filter((k) => systems[k] && systems[k].status === 'down').length;
  const embed = new EmbedBuilder()
    .setTitle(`${statusEmoji(ov.state)} __${ov.text}__`)
    .setColor(ov.state === 'green' ? 0x57f287 : ov.state === 'orange' ? 0xfaa61a : 0xed4245)
    .setTimestamp(new Date());

  const summaryLine = `Updated <t:${Math.floor(Date.now() / 1000)}:R> | Components ${keys.length} | Up ${upCount} | Degraded ${degradedCount} | Down ${downCount}`;
  embed.setDescription(summaryLine);
  embed.addFields({ name: 'Systems', value: buildSystemLines().join('\n').slice(0, 1024) });

  // Add shard / server / user summary if client available
  try {
    if (clientRef && clientRef.user) {
      const serverCount = clientRef.guilds?.cache?.size || 0;
      const userCount = clientRef.guilds?.cache ? clientRef.guilds.cache.reduce((total, g) => total + (g.memberCount || 0), 0) : 0;
      let shardLabel = '';
      if (clientRef.shard && Array.isArray(clientRef.shard.ids) && clientRef.shard.count) {
        shardLabel = `Shard ${clientRef.shard.ids[0]}/${clientRef.shard.count}`;
      } else if (process.env.SHARD_ID) {
        shardLabel = `Shard ${process.env.SHARD_ID}`;
      }
      const wsPing = Number.isFinite(clientRef.ws?.ping) ? `${clientRef.ws.ping}ms` : 'n/a';
      const memoryMb = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
      const runtime = [
        `Uptime ${formatDuration(Date.now() - monitorStartedAt)}`,
        `WS ${wsPing}`,
        `RSS ${memoryMb}MB`,
        `Node ${process.version}`
      ].join(' | ');
      const summary = `${shardLabel ? shardLabel + ' | ' : ''}${serverCount.toLocaleString()} servers | ${userCount.toLocaleString()} users`;
      embed.addFields(
        { name: 'Discord', value: summary },
        { name: 'Runtime', value: runtime }
      );
    }
  } catch (e) {
    logger.warn('Failed adding shard/server/user summary to status embed', { error: e && (e.stack || e) });
  }

  // Include basic metrics from guildJoinWorker if available
  try {
    const gj = require('../workers/guildJoinWorker');
    if (gj && typeof gj.getMetrics === 'function') {
      const m = gj.getMetrics();
      const parts = [];
      if (typeof m.totalBatchesFlushed === 'number') parts.push(`batches ${m.totalBatchesFlushed}`);
      if (typeof m.totalJobsProcessed === 'number') parts.push(`jobs ${m.totalJobsProcessed}`);
      if (typeof m.totalEnqueued === 'number') parts.push(`enqueued ${m.totalEnqueued}`);
      if (parts.length) embed.addFields({ name: 'Join Worker', value: parts.join(' | ') });
    }
  } catch (e) {
    // ignore if worker not available
  }

  return embed;
}

function buildStatusText() {
  const ov = overallStatus();
  const header = `${statusEmoji(ov.state)} ${ov.text}`;
  const keys = Object.keys(systems);
  const upCount = keys.filter((k) => systems[k] && systems[k].status === 'up').length;
  const degradedCount = keys.filter((k) => systems[k] && systems[k].status === 'degraded').length;
  const downCount = keys.filter((k) => systems[k] && systems[k].status === 'down').length;
  const summary = `Updated ${new Date().toISOString()} | Components ${keys.length} | Up ${upCount} | Degraded ${degradedCount} | Down ${downCount}`;
  const lines = buildSystemLines().map((line) => line.replace(/\*\*/g, ''));
  return `${header}\n${summary}\n${lines.join('\n')}`;
}

async function ensureChannelAndMessage() {
  if (!clientRef || !channelId) return null;
  try {
    const ch = await clientRef.channels.fetch(channelId).catch(() => null);
    if (!ch) {
      logger.warn('Configured status channel not found or inaccessible', { channelId });
      return null;
    }

    // If we already have a message id (from memory or persisted file), try to fetch and edit it
    if (statusMessageId) {
      try {
        const existing = await ch.messages.fetch(statusMessageId).catch(() => null);
        if (existing) {
          logger.info('Found persisted status message', { messageId: statusMessageId });
          return { channel: ch, message: existing };
        } else {
          logger.info('Persisted statusMessageId not found in channel; will search recent messages', { statusMessageId });
        }
      } catch (e) { logger.warn('Error fetching persisted status message id', { statusMessageId, error: e && (e.stack || e) }); }
    }

    // If we couldn't fetch by id, try to find a recent status message from this bot in the channel
    try {
      const recent = await ch.messages.fetch({ limit: 50 }).catch((e) => { logger.warn('Failed fetching recent messages for status search', { channelId, error: e && (e.stack || e) }); return null; });
      if (recent) {
        const found = recent.find(m => m.author && clientRef && clientRef.user && m.author.id === clientRef.user.id && m.embeds && m.embeds.length && m.embeds[0].title && /system|systems|status/i.test(m.embeds[0].title));
        if (found) {
          logger.info('Found recent status message', { messageId: found.id });
          statusMessageId = found.id;
          persist();
          return { channel: ch, message: found };
        }
        logger.info('No recent status message found in channel');
      }
    } catch (e) { logger.warn('Error searching recent messages for status message', { channelId, error: e && (e.stack || e) }); }

    // No existing message found; return channel for caller to create the message if desired
    return { channel: ch, message: null };
  } catch (e) {
    logger.warn('ensureChannelAndMessage failed', { error: e && (e.stack || e) });
    return null;
  }
}

async function createStatusMessage(channel) {
  try {
    logger.info('Creating new status message in channel', { channelId: channel.id });
    const sent = await channel.send({ embeds: [buildStatusEmbed()] }).catch((e) => { logger.warn('Failed sending status message (embed)', { channelId: channel.id, error: e && (e.stack || e) }); return null; });
    if (sent) {
      statusMessageId = sent.id;
      persist();
      return sent;
    }
    return null;
  } catch (e) {
    logger.warn('createStatusMessage failed', { error: e && (e.stack || e) });
    return null;
  }
}

async function updateStatusMessage() {
  if (statusUpdateInFlight) return statusUpdateInFlight;
  statusUpdateInFlight = (async () => {
  try {
    const ctx = await ensureChannelAndMessage();
    if (!ctx || !ctx.channel) return;
    // If there's an existing message, edit it to update the embed; otherwise create one.
    if (ctx.message) {
      try {
        await ctx.message.edit({ embeds: [buildStatusEmbed()] });
        logger.section(`Edited existing status message (${ctx.message.id})`);
        logger.info('Edited existing status message', { messageId: ctx.message.id });
        return;
      } catch (e) {
        const errMsg = String(e && (e.message || e));
        const isUnknownMessage = /unknown message/i.test(errMsg) || (e && e.code === 10008);
        if (isUnknownMessage) {
          // message deleted: clear persisted id and recreate
          statusMessageId = null;
          persist();
          const sent = await createStatusMessage(ctx.channel);
          if (sent) {
            logger.section(`Recreated status message after missing on update (${sent.id})`);
            logger.info('Recreated status message after missing on update', { messageId: sent.id });
            return;
          }
        }
        logger.warn('Failed editing status message (embed)', { error: e && (e.stack || e) });
        return;
      }
    }

    // No existing message -> create one
    try {
      const sent = await createStatusMessage(ctx.channel);
      if (sent) logger.info('Created status message during updateStatusMessage', { messageId: sent.id });
    } catch (e) {
      logger.warn('Failed creating status message during updateStatusMessage', { error: e && (e.stack || e) });
    }
  } catch (e) {
    logger.warn('updateStatusMessage failed', { error: e && (e.stack || e) });
  }
  })().finally(() => {
    statusUpdateInFlight = null;
  });

  return statusUpdateInFlight;
}

function registerSystem(key, opts = {}) {
  const { name = key, shutdown = null } = opts;
  systems[key] = { name, status: 'up', reason: null, shutdown };
  setImmediate(() => updateStatusMessage().catch(() => {}));
}

async function markDown(key, reason) {
  if (!systems[key]) systems[key] = { name: key, status: 'down', reason: reason || 'Unknown', shutdown: null };
  systems[key].status = 'down';
  systems[key].reason = reason || 'Unknown';
  logger.warn('System marked down', { key, reason });
  // Attempt to invoke shutdown hook if present
  try {
    if (systems[key] && typeof systems[key].shutdown === 'function') {
      try {
        const shutdownPromise = Promise.resolve(systems[key].shutdown());
        const res = await Promise.race([
          shutdownPromise.then(() => ({ ok: true })).catch(e => ({ ok: false, error: e })),
          new Promise(resolve => setTimeout(() => resolve({ ok: false, timeout: true }), SHUTDOWN_HOOK_TIMEOUT_MS))
        ]);
        if (res.timeout) {
          logger.warn('Shutdown hook timed out', { key, timeoutMs: SHUTDOWN_HOOK_TIMEOUT_MS });
        } else if (!res.ok) {
          logger.warn('Shutdown hook failed', { key, error: res.error && (res.error.stack || res.error) });
        }
      } catch (e) {
        logger.warn('Shutdown hook invocation error', { key, error: e && (e.stack || e) });
      }
    }
  } catch (e) { logger.warn('markDown shutdown failed', { key, error: e && (e.stack || e) }); }
  try {
    await updateStatusMessage();
    logger.info('Status message updated after markDown', { key });
  } catch (e) {
    logger.warn('updateStatusMessage failed after markDown', { key, error: e && (e.stack || e) });
  }
}

function markUp(key) {
  if (!systems[key]) systems[key] = { name: key, status: 'up', reason: null, shutdown: null };
  systems[key].status = 'up';
  systems[key].reason = null;
  setImmediate(() => updateStatusMessage().catch(() => {}));
}

async function markAllDown(reason) {
  const keys = Object.keys(systems);
  for (const k of keys) {
    try {
      // reuse markDown to preserve shutdown hook behavior
       
      await markDown(k, reason).catch(() => {});
    } catch (_) { /* ignore individual failures */ }
  }
}

async function init(client, chId) {
  clientRef = client;
  channelId = String(chId);
  // register a default 'bot' system without triggering an update (prevents double-send during init)
  systems['bot'] = { name: 'Bot Process', status: 'up', reason: null, shutdown: null };
  // create or fetch the status message and apply the current status embed
  const ctx = await ensureChannelAndMessage();
  if (!ctx) {
    logger.warn('No channel context available for systemMonitor.init', { channelId });
    return;
  }

  try {
    if (ctx.message) {
      logger.info('Attempting to edit existing status message on init', { messageId: ctx.message.id, persistedId: statusMessageId });
      await ctx.message.edit({ embeds: [buildStatusEmbed()] });
      logger.info('Edited existing status message on init', { messageId: ctx.message.id });
    } else if (ctx.channel) {
      // No message found; create a single embed message
      const sent = await createStatusMessage(ctx.channel);
      if (sent) logger.info('Created status message during init', { messageId: sent.id });
      else logger.warn('Failed to create status message during init', { channelId });
    }
  } catch (e) {
    logger.warn('Failed editing/creating status message on init', { messageId: ctx.message?.id, error: e && (e.stack || e) });
  }

  // Start periodic status updates so counts/metrics stay fresh
  try {
    const intervalMs = Number(process.env.SYSTEM_MONITOR_UPDATE_MS) || 30000;
    if (statusUpdateTimer) clearInterval(statusUpdateTimer);
    statusUpdateTimer = setInterval(() => {
      try { updateStatusMessage().catch(() => {}); } catch (_) { /* ignore */ }
    }, intervalMs);
    if (typeof statusUpdateTimer.unref === 'function') statusUpdateTimer.unref();
    logger.info('Started periodic system monitor updates', { intervalMs });
  } catch (e) {
    logger.warn('Failed starting periodic system monitor updates', { error: e && (e.stack || e) });
  }
}

module.exports = { init, registerSystem, markDown, markUp, markAllDown, buildStatusEmbed, buildStatusText };
