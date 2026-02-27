const logger = require('../utils/logger').get('ready');
const db = require('../db');
const cache = require('../utils/cache');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.info('Logged in', { user: client.user.tag, id: client.user.id });
    // Also print to console so it's visible in plain stdout
    // eslint-disable-next-line no-console
    console.log(`Logged in as ${client.user.tag} (${client.user.id})`);

    // Warm-up guild settings cache: load all guild_settings into cache for quick access
    try {
      const rows = await db.knex('guild_settings').select('*');
      for (const row of rows) {
        const parsed = row.data ? JSON.parse(row.data) : null;
        const entry = {
          id: row.id,
          guild_id: row.guild_id,
          channel_id: row.channel_id,
          spawn_rate_minutes: row.spawn_rate_minutes,
          egg_limit: row.egg_limit,
          data: parsed,
          created_at: row.created_at,
          updated_at: row.updated_at
        };
        cache.set(`guild:${row.guild_id}`, entry, Number(process.env.GUILD_CACHE_TTL_MS) || 30000);
      }
      logger.info('Guild settings cache warm-up complete', { count: rows.length });
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
      await hatchManager.init();
    } catch (err) {
      logger.error('Failed initializing hatch manager', { error: err && (err.stack || err) });
    }

    // Start cycling presence if configured
    try {
      const config = require('../../config/config.json');
      const presence = config.presence;
      if (presence && Array.isArray(presence.activities) && presence.activities.length > 0) {
        let idx = 0;
        const { ActivityType } = require('discord.js');
        const setPresence = async () => {
          try {
            const item = presence.activities[idx % presence.activities.length];
            // allow either string or object { name, type }
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
            if (activity) await client.user.setPresence({ activities: [activity], status: presence.status || 'online' });
            idx++;
          } catch (e) {
            logger.warn('Failed to set presence', { error: e && (e.stack || e) });
          }
        };
        // set immediately then interval
        setPresence();
        const intervalMs = (presence.intervalSeconds || 60) * 1000;
        setInterval(setPresence, intervalMs);
        logger.info('Presence cycling started', { count: presence.activities.length, intervalSeconds: presence.intervalSeconds || 60 });
      }
    } catch (err) {
      logger.warn('Presence cycling not configured or failed to start', { error: err && (err.stack || err) });
    }
  }
};
