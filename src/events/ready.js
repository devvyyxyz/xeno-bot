const logger = require('../utils/logger').get('ready');
const db = require('../db');
const cache = require('../utils/cache');

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
      const statusCycling = config.statusCycling;
      
      // Enable status cycling by default unless explicitly disabled
      if (statusCycling && statusCycling.enabled === false) {
        logger.info('Status cycling disabled in config');
      } else {
        let idx = 0;
        const { ActivityType } = require('discord.js');
        
        // Generate dynamic status messages based on config
        const generateActivities = () => {
          const activities = [];
          
          // Member count across all guilds (if enabled in config)
          if (statusCycling?.displayMembers !== false) {
            const memberCount = client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0);
            activities.push({
              name: `${memberCount.toLocaleString()} members`,
              type: ActivityType.Watching
            });
          }
          
          // Server/guild count (if enabled in config)
          if (statusCycling?.displayServers !== false) {
            const serverCount = client.guilds.cache.size;
            activities.push({
              name: `${serverCount.toLocaleString()} servers`,
              type: ActivityType.Watching
            });
          }
          
          // Shard info (if sharded and enabled in config)
          if (client.shard && statusCycling?.displayShard !== false) {
            const shardId = client.shard.ids[0];
            const shardCount = client.shard.count;
            activities.push({
              name: `Shard ${shardId}/${shardCount - 1}`,
              type: ActivityType.Playing
            });
          }
          
          // Add custom activities from config if any
          if (statusCycling?.customActivities && Array.isArray(statusCycling.customActivities) && statusCycling.customActivities.length > 0) {
            for (const item of statusCycling.customActivities) {
              let activity = null;
              if (typeof item === 'string') {
                activity = { name: item };
              } else if (item && typeof item === 'object') {
                const name = item.name || item.text || '';
                let typeVal = undefined;
                if (item.type) {
                  const t = String(item.type).toUpperCase();
                  if (ActivityType[t] !== undefined) typeVal = ActivityType[t];
                }
                activity = typeVal !== undefined ? { name, type: typeVal } : { name };
              }
              if (activity) activities.push(activity);
            }
          }
          
          return activities.length > 0 ? activities : [];
        };
        
        const setPresence = async () => {
          try {
            const activities = generateActivities();
            if (activities.length > 0) {
              const activity = activities[idx % activities.length];
              const status = statusCycling?.status || 'online';
              await client.user.setPresence({ activities: [activity], status });
              idx++;
            }
          } catch (e) {
            logger.warn('Failed to set presence', { error: e && (e.stack || e) });
          }
        };
        
        // set immediately then interval
        setPresence();
        const intervalMs = (statusCycling?.intervalSeconds || 30) * 1000;
        setInterval(setPresence, intervalMs);
        logger.info('Status cycling started', { 
          intervalSeconds: statusCycling?.intervalSeconds || 30,
          displayMembers: statusCycling?.displayMembers !== false,
          displayServers: statusCycling?.displayServers !== false,
          displayShard: statusCycling?.displayShard !== false,
          customActivities: statusCycling?.customActivities?.length || 0
        });
      }
    } catch (err) {
      logger.warn('Status cycling not configured or failed to start', { error: err && (err.stack || err) });
    }
  }
};
