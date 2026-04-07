const utils = require('../utils');
const logger = utils.logger.get('ready');
const db = require('../db');
const cache = utils.cache;

// Store interval reference to clean up on reconnect
let statusCyclingInterval = null;
let statusFailureStreak = 0;

function toSafeIntervalMs(...candidates) {
  for (const candidate of candidates) {
    const asNumber = Number(candidate);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      // Discord presence updates should not run too frequently.
      const clampedSeconds = Math.max(15, Math.floor(asNumber));
      return clampedSeconds * 1000;
    }
  }

  return 30000;
}

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.info(`Logged in as ${client.user.tag} (${client.user.id})`, { user: client.user.tag, id: client.user.id });
    // Avoid raw console output; log via logger for consistent formatting
    // (previously also printed a plain "Logged in as..." line to stdout)

    // Warm-up guild settings cache for guilds this shard actually serves.
    // Loading every guild in a sharded deployment can cause large heap spikes.
    try {
      const guildIds = Array.from(client.guilds.cache.keys());
      const ttlMs = Number(process.env.GUILD_CACHE_TTL_MS) || 30000;
      const chunkSize = Number(process.env.GUILD_CACHE_WARMUP_CHUNK) || 250;
      let totalLoaded = 0;

      for (let i = 0; i < guildIds.length; i += chunkSize) {
        const chunk = guildIds.slice(i, i + chunkSize);
        if (!chunk.length) continue;
        let rows = [];
        try {
          rows = await db.knex('guild_settings')
            .select('id', 'guild_id', 'channel_id', 'spawn_min_seconds', 'spawn_max_seconds', 'egg_limit', 'data', 'created_at', 'updated_at')
            .whereIn('guild_id', chunk.map(String));
        } catch (chunkErr) {
          // Some DB/driver setups can be strict about whereIn parameter handling.
          // Fallback to per-guild queries so startup can continue safely.
          logger.warn('Chunked guild settings warm-up failed, using per-guild fallback', { error: chunkErr && (chunkErr.stack || chunkErr), chunkSize: chunk.length });
          for (const guildId of chunk) {
            const row = await db.knex('guild_settings')
              .select('id', 'guild_id', 'channel_id', 'spawn_min_seconds', 'spawn_max_seconds', 'egg_limit', 'data', 'created_at', 'updated_at')
              .where({ guild_id: String(guildId) })
              .first();
            if (row) rows.push(row);
          }
        }

        for (const row of rows) {
          let parsed = null;
          try {
            parsed = row.data ? JSON.parse(row.data) : null;
          } catch (_) {
            parsed = null;
          }

          // Normalize spawn timing fields into cache so consumers don't see missing fields
          const spawnMin = row.spawn_min_seconds != null ? row.spawn_min_seconds : (row.spawn_rate_minutes != null ? Number(row.spawn_rate_minutes) * 60 : null);
          const spawnMax = row.spawn_max_seconds != null ? row.spawn_max_seconds : (row.spawn_rate_minutes != null ? Number(row.spawn_rate_minutes) * 60 : null);
          const entry = {
            id: row.id,
            guild_id: row.guild_id,
            channel_id: row.channel_id,
            spawn_min_seconds: spawnMin,
            spawn_max_seconds: spawnMax,
            spawn_rate_minutes: row.spawn_rate_minutes,
            egg_limit: row.egg_limit,
            data: parsed,
            created_at: row.created_at,
            updated_at: row.updated_at
          };
          cache.set(`guild:${row.guild_id}`, entry, ttlMs);
          totalLoaded += 1;
        }
      }

      logger.info('Guild settings cache warm-up complete', { loaded: totalLoaded, shardGuilds: guildIds.length, chunkSize });
    } catch (err) {
      logger.error('Failed warming guild settings cache', { error: err.stack || err });
    }
    // initialize spawn manager for scheduled spawns
    try {
      const spawnManager = require('../spawnManager');
      await spawnManager.init(client);
    } catch (err) {
      logger.error('Failed initializing spawn manager', { error: err && (err.stack || err) });
    }

    // initialize hatch manager for egg hatches
    try {
      const hatchManager = require('../hatchManager');
      await hatchManager.init(client);
    } catch (err) {
      logger.error('Failed initializing hatch manager', { error: err && (err.stack || err) });
    }

    // Start cycling presence if configured
    try {
      const config = require('../../config/config.json');
      const presenceConfig = config.presence || {};
      const statusCycling = config.statusCycling || {};
      const { ActivityType } = require('discord.js');

      // Build a case-insensitive lookup for ActivityType keys
      const activityTypeMap = {};
      for (const [k, v] of Object.entries(ActivityType || {})) {
        activityTypeMap[String(k).toLowerCase()] = v;
      }

      const normalizeActivity = (entry) => {
        if (!entry) return null;

        if (typeof entry === 'string') {
          const raw = entry.trim();
          if (!raw) return null;

          const stringPatterns = [
            { pattern: /^playing\s+/i, type: 'Playing' },
            { pattern: /^watching\s+/i, type: 'Watching' },
            { pattern: /^listening to\s+/i, type: 'Listening' },
            { pattern: /^streaming\s+/i, type: 'Streaming' },
            { pattern: /^competing in\s+/i, type: 'Competing' },
          ];

          for (const { pattern, type } of stringPatterns) {
            if (pattern.test(raw)) {
              return normalizeActivity({
                name: raw.replace(pattern, '').trim(),
                type,
              });
            }
          }

          return { name: raw };
        }

        if (typeof entry === 'object') {
          const name = String(entry.name || '').trim();
          if (!name) return null;

          const rawType = entry.type;
          let type = null;
          if (rawType !== undefined && rawType !== null) {
            if (typeof rawType === 'number' && Number.isFinite(rawType)) {
              type = rawType;
            } else {
              const normalized = String(rawType).trim().toLowerCase();
              if (normalized && activityTypeMap[normalized] !== undefined) {
                type = activityTypeMap[normalized];
              }
            }
          }

          const normalized = { name };
          if (type !== null) normalized.type = type;
          return normalized;
        }

        return null;
      };

      let idx = 0;

      const generateActivities = () => {
        const serverCount = client.guilds.cache.size || 0;
        const name = `${serverCount.toLocaleString()} servers`;
        return [{ name, type: ActivityType.Watching }];
      };

      const setPresence = async () => {
        try {
          if (!client || !client.user) return;
          const activities = generateActivities();
          if (activities.length > 0) {
            const activity = activities[idx % activities.length];
            if (!activity || !activity.name) return;
            const rawStatus = String(presenceConfig.status || statusCycling.status || 'online').toLowerCase();
            const status = ['online', 'idle', 'dnd', 'invisible'].includes(rawStatus) ? rawStatus : 'online';
            const act = { name: String(activity.name) };
            const parsedType = Number(activity.type);
            if (Number.isFinite(parsedType)) act.type = parsedType;
            await client.user.setPresence({ activities: [act], status });
            idx++;
            statusFailureStreak = 0;
          }
        } catch (e) {
          statusFailureStreak += 1;
          logger.warn('Failed to set presence', { error: e && (e.stack || e), streak: statusFailureStreak });
          if (statusFailureStreak === 3) {
            logger.warn('Presence updates are failing repeatedly; keeping retry loop active for automatic recovery');
          }
        }
      };

      // set immediately then interval
      setPresence();
      const intervalMs = toSafeIntervalMs(
        presenceConfig.intervalSeconds,
        statusCycling.intervalSeconds,
        30
      );
      if (statusCyclingInterval) {
        clearInterval(statusCyclingInterval);
        logger.debug('Cleared previous status cycling interval');
      }
      statusFailureStreak = 0;
      statusCyclingInterval = setInterval(setPresence, intervalMs);
      logger.info('Presence updates started', {
        source: 'server-count-only',
        intervalSeconds: Math.floor(intervalMs / 1000),
        displayServers: true,
      });
    } catch (err) {
      logger.warn('Presence updates not configured or failed to start', { error: err && (err.stack || err) });
    }
  }
};
