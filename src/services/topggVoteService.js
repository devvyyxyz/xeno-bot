const crypto = require('crypto');
const express = require('express');
const utils = require('../utils');

const logger = utils.logger.get('topggVoteService');
const links = require('../../config/links.json');

const DEFAULT_REMINDER_DELAY_MS = 12 * 60 * 60 * 1000;
const DEFAULT_WEBHOOK_PATH = '/webhooks/topgg';
const DEFAULT_WEBHOOK_PORT = 3001;
const DEFAULT_WEBHOOK_HOST = '0.0.0.0';

let client = null;
let app = null;
let server = null;
let reminderQueue = null;
let reminderWorker = null;
let queueLoadFailed = false;
const fallbackTimers = new Map();

function getVoteUrl() {
  return String((links?.general?.vote || links?.vote || process.env.TOPGG_VOTE_URL || '')).trim();
}

function getSettings() {
  const enabled = String(process.env.TOPGG_WEBHOOK_ENABLED || 'true').toLowerCase() !== 'false';
  const secret = String(process.env.TOPGG_WEBHOOK_AUTH || '').trim();
  const host = String(process.env.TOPGG_WEBHOOK_HOST || DEFAULT_WEBHOOK_HOST).trim() || DEFAULT_WEBHOOK_HOST;
  const port = Number(process.env.TOPGG_WEBHOOK_PORT) || DEFAULT_WEBHOOK_PORT;
  const path = String(process.env.TOPGG_WEBHOOK_PATH || DEFAULT_WEBHOOK_PATH).trim() || DEFAULT_WEBHOOK_PATH;
  const delayMs = Math.max(1000, Number(process.env.TOPGG_VOTE_REMINDER_DELAY_MS) || DEFAULT_REMINDER_DELAY_MS);
  const shardId = String(process.env.TOPGG_WEBHOOK_SHARD_ID || '0');
  return { enabled, secret, host, port, path, delayMs, shardId };
}

function shouldRunOnThisProcess() {
  const settings = getSettings();
  if (!settings.enabled) return false;
  if (!settings.secret) return false;
  const currentShardId = process.env.SHARD_ID;
  if (currentShardId == null || currentShardId === '') return true;
  return String(currentShardId) === settings.shardId;
}

function extractVoteUserId(payload) {
  const source = payload && payload.data ? payload.data : payload;
  const candidate = source && (
    source.discord_id ||
    source.discordId ||
    source.platform_id ||
    source.user?.platform_id ||
    source.user?.discord_id ||
    source.user?.discordId ||
    source.user?.id ||
    source.userId ||
    source.user_id ||
    source.id
  );

  if (!candidate) return null;
  if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  if (typeof candidate === 'object') {
    const nested = candidate.id || candidate.user_id || candidate.userId || candidate.platform_id;
    return nested ? String(nested) : null;
  }
  return null;
}

function normalizeVoteType(payload) {
  const rawType = payload && (payload.type || payload.event || payload.voteType || payload.action);
  return String(rawType || '').trim().toLowerCase();
}

function isVotePayload(payload) {
  const type = normalizeVoteType(payload);
  return type === 'vote.create' || type === 'webhook.test' || type === 'vote' || type === 'upvote' || type === 'test';
}

function parseTopggSignature(headerValue) {
  const header = String(headerValue || '').trim();
  if (!header) return null;
  const parts = header.split(',').map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signaturePart = parts.find((part) => part.startsWith('v1='));
  const timestamp = timestampPart ? Number(timestampPart.slice(2)) : NaN;
  const signature = signaturePart ? signaturePart.slice(3) : '';
  if (!Number.isFinite(timestamp) || !signature) return null;
  return { timestamp, signature };
}

function verifyTopggSignature(rawBody, headerValue, secret) {
  const parsed = parseTopggSignature(headerValue);
  if (!parsed || !secret) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > 5 * 60) return false;
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${bodyBuffer.toString('utf8')}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parsed.signature, 'hex'));
  } catch (_) {
    return false;
  }
}

function extractVoteReminderAt(payload) {
  const source = payload && payload.data ? payload.data : payload;
  const expiresAt = source && source.expires_at ? new Date(source.expires_at) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime())) return expiresAt.getTime();
  const createdAt = source && source.created_at ? new Date(source.created_at) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) {
    return createdAt.getTime() + DEFAULT_REMINDER_DELAY_MS;
  }
  return Date.now() + DEFAULT_REMINDER_DELAY_MS;
}

function buildVoteDmContent({ reminder = false, nextVoteAt = null } = {}) {
  const voteUrl = getVoteUrl() || 'https://top.gg/bot/1476427270326583306/vote';
  if (reminder) {
    return [
      'Your next Xeno Bot vote on Top.gg is ready again.',
      `Vote here: ${voteUrl}`,
    ].join('\n\n');
  }

  const lines = [
    'Thanks for voting for Xeno Bot on Top.gg.',
  ];

  if (nextVoteAt) {
    lines.push(`You can vote again <t:${Math.floor(nextVoteAt / 1000)}:R>.`);
  }

  lines.push(`Vote here: ${voteUrl}`);
  lines.push('I will DM you again when the next vote reminder is ready.');
  return lines.join('\n\n');
}

async function sendVoteDm(userId, options = {}) {
  if (!client) {
    return { ok: false, reason: 'client_not_ready' };
  }

  let user = client.users && client.users.cache ? client.users.cache.get(String(userId)) : null;
  if (!user && client.users && typeof client.users.fetch === 'function') {
    try {
      user = await client.users.fetch(String(userId));
    } catch (fetchErr) {
      logger.warn('Failed fetching user for Top.gg vote DM', {
        userId: String(userId),
        error: fetchErr && (fetchErr.stack || fetchErr),
      });
      return { ok: false, reason: 'user_fetch_failed' };
    }
  }

  if (!user || typeof user.send !== 'function') {
    return { ok: false, reason: 'user_not_found' };
  }

  const content = buildVoteDmContent(options);
  try {
    await user.send({ content });
    return { ok: true };
  } catch (err) {
    logger.warn('Failed sending Top.gg vote DM', {
      userId: String(userId),
      error: err && (err.stack || err),
    });
    return { ok: false, reason: 'dm_failed', error: err && (err.message || String(err)) };
  }
}

function ensureReminderQueue() {
  if (queueLoadFailed || reminderQueue) return reminderQueue;
  try {
    const { createQueue } = require('../lib/queue');
    reminderQueue = createQueue('topgg-vote-reminders');
  } catch (err) {
    queueLoadFailed = true;
    logger.warn('Top.gg vote reminder queue unavailable; falling back to timers', {
      error: err && (err.stack || err),
    });
  }
  return reminderQueue;
}

function ensureReminderWorker() {
  if (reminderWorker || queueLoadFailed || !client) return reminderWorker;
  try {
    const { createWorker } = require('../lib/queue');
    reminderWorker = createWorker('topgg-vote-reminders', async (job) => {
      const data = job && job.data ? job.data : {};
      const userId = data.userId ? String(data.userId) : null;
      if (!userId) {
        return { ok: false, reason: 'missing_user_id' };
      }
      const result = await sendVoteDm(userId, { reminder: true });
      return { ok: !!result.ok };
    });
    logger.info('Top.gg vote reminder worker started');
  } catch (err) {
    queueLoadFailed = true;
    logger.warn('Top.gg vote reminder worker unavailable; falling back to timers', {
      error: err && (err.stack || err),
    });
  }
  return reminderWorker;
}

function scheduleFallbackReminder(userId, delayMs, jobKey) {
  if (fallbackTimers.has(jobKey)) {
    try {
      clearTimeout(fallbackTimers.get(jobKey));
    } catch (_) {
      /* ignore */
    }
  }

  const timer = setTimeout(async () => {
    fallbackTimers.delete(jobKey);
    try {
      await sendVoteDm(userId, { reminder: true });
    } catch (err) {
      logger.warn('Top.gg vote reminder fallback timer failed', {
        userId: String(userId),
        error: err && (err.stack || err),
      });
    }
  }, Math.max(1000, delayMs));

  if (typeof timer.unref === 'function') timer.unref();
  fallbackTimers.set(jobKey, timer);
}

async function scheduleReminder(userId, voteAt) {
  const settings = getSettings();
  const reminderAt = Number(voteAt) || (Date.now() + settings.delayMs);
  const delayMs = Math.max(0, reminderAt - Date.now());
  const jobKey = `topgg-vote-reminder:${String(userId)}:${String(voteAt)}`;

  const queue = ensureReminderQueue();
  if (!queue) {
    scheduleFallbackReminder(userId, delayMs, jobKey);
    return { ok: true, mode: 'timer' };
  }

  try {
    await queue.add(
      'voteReminder',
      {
        userId: String(userId),
        voteAt: Number(voteAt),
        reminderAt,
      },
      {
        jobId: jobKey,
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'fixed', delay: 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
    return { ok: true, mode: 'queue' };
  } catch (err) {
    logger.warn('Failed to queue Top.gg vote reminder; falling back to timer', {
      userId: String(userId),
      error: err && (err.stack || err),
    });
    scheduleFallbackReminder(userId, delayMs, jobKey);
    return { ok: true, mode: 'timer' };
  }
}

async function handleVoteWebhook(req, res) {
  try {
    const settings = getSettings();
    const signatureHeader = req.get('x-topgg-signature');
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    if (!settings.secret || !verifyTopggSignature(rawBody, signatureHeader, settings.secret)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const payload = req.body || {};
    if (normalizeVoteType(payload) === 'webhook.test') {
      logger.info('Received Top.gg webhook test event');
      res.status(204).end();
      return;
    }

    const userId = extractVoteUserId(payload);
    if (!userId || normalizeVoteType(payload) !== 'vote.create') {
      res.status(204).end();
      return;
    }

    const voteAt = payload?.data?.created_at ? new Date(payload.data.created_at).getTime() : Date.now();
    const nextVoteAt = extractVoteReminderAt(payload);

    const immediateDm = await sendVoteDm(userId, { nextVoteAt });
    const reminder = await scheduleReminder(userId, nextVoteAt);

    logger.info('Processed Top.gg vote webhook', {
      userId: String(userId),
      immediateDm: immediateDm && immediateDm.ok,
      reminderMode: reminder && reminder.mode,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('Top.gg vote webhook handler failed', { error: err && (err.stack || err) });
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
}

function startServer() {
  if (server) return server;
  if (!shouldRunOnThisProcess()) {
    logger.info('Top.gg vote webhook disabled for this process');
    return null;
  }

  const settings = getSettings();
  app = express();
  app.disable('x-powered-by');
  app.use(express.json({
    limit: '64kb',
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }));
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post(settings.path, handleVoteWebhook);

  server = app.listen(settings.port, settings.host, () => {
    logger.info('Top.gg vote webhook server listening', {
      host: settings.host,
      port: settings.port,
      path: settings.path,
      shardId: process.env.SHARD_ID || 'single',
    });
  });

  server.on('error', (err) => {
    logger.error('Top.gg vote webhook server error', { error: err && (err.stack || err) });
  });

  return server;
}

function init(botClient) {
  client = botClient;
  startServer();
  ensureReminderWorker();
}

async function shutdown() {
  try {
    for (const timer of fallbackTimers.values()) {
      try {
        clearTimeout(timer);
      } catch (_) {
        /* ignore */
      }
    }
    fallbackTimers.clear();
  } catch (_) {
    /* ignore */
  }

  try {
    if (reminderWorker && typeof reminderWorker.close === 'function') {
      await reminderWorker.close();
    }
  } catch (err) {
    logger.warn('Failed closing Top.gg vote reminder worker', { error: err && (err.stack || err) });
  }

  try {
    if (reminderQueue && typeof reminderQueue.close === 'function') {
      await reminderQueue.close();
    }
  } catch (err) {
    logger.warn('Failed closing Top.gg vote reminder queue', { error: err && (err.stack || err) });
  }

  try {
    if (server && typeof server.close === 'function') {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  } catch (err) {
    logger.warn('Failed closing Top.gg vote webhook server', { error: err && (err.stack || err) });
  }

  server = null;
  app = null;
  reminderWorker = null;
  reminderQueue = null;
  queueLoadFailed = false;
  client = null;
}

module.exports = {
  init,
  shutdown,
  buildVoteDmContent,
  extractVoteUserId,
  isVotePayload,
  normalizeVoteType,
  parseTopggSignature,
  verifyTopggSignature,
  extractVoteReminderAt,
  scheduleReminder,
  sendVoteDm,
  shouldRunOnThisProcess,
};