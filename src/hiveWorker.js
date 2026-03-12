const db = require('./db');
const utils = require('./utils');
const baseLogger = utils.logger;
const logger = baseLogger.get('hiveWorker');
const models = require('./models');
const userModel = models.user;
const hiveModel = models.hive;

let _interval = null;

async function processHives() {
  try {
    const now = Date.now();
    const msPerHour = 3600000;
    // load all hives with production > 0
    const rows = await db.knex('hives').where('jelly_production_per_hour', '>', 0).select('*');
    if (!rows || rows.length === 0) return 0;
    let processed = 0;
    for (const r of rows) {
      try {
        const hive = r;
        const ownerId = String(hive.user_id || hive.owner_discord_id || '');
        const guildId = hive.guild_id || null;
        const rate = Number(hive.jelly_production_per_hour || 0);
        if (!rate || rate <= 0) continue;
        // determine last_collected timestamp from data JSON
        let data = null;
        try {
          data = hive.data ? JSON.parse(hive.data) : {};
        } catch (e) {
          data = {};
        }
        const lastCollected =
          Number(data && data.last_collected_at) || Number(hive.created_at) || now;
        const elapsedMs = Math.max(0, now - lastCollected);
        // compute amount to award
        const amount = Math.floor((elapsedMs * rate) / msPerHour);
        if (amount > 0) {
          // award amount
          try {
            await userModel.modifyCurrencyForGuild(ownerId, guildId, 'royal_jelly', Number(amount));
            logger.info('Awarded hive production', { hiveId: hive.id, ownerId, guildId, amount });
          } catch (e) {
            logger.warn('Failed awarding hive production', {
              hiveId: hive.id,
              ownerId,
              guildId,
              amount,
              error: e && (e.stack || e),
            });
            continue;
          }
          // advance last_collected by the amount awarded
          const consumedMs = Math.floor((amount * msPerHour) / rate);
          const newLast = lastCollected + consumedMs;
          const newData = Object.assign({}, data, { last_collected_at: newLast });
          try {
            await hiveModel.updateHiveById(hive.id, { data: newData });
            processed += 1;
          } catch (e) {
            logger.warn('Failed updating hive last_collected', {
              hiveId: hive.id,
              error: e && (e.stack || e),
            });
          }
        }
      } catch (e) {
        logger.warn('Failed processing hive row', { row: r && r.id, error: e && (e.stack || e) });
      }
    }
    return processed;
  } catch (e) {
    logger.error('Hive worker failed', { error: e && (e.stack || e) });
    return 0;
  }
}

async function start(opts = {}) {
  const pollMs = opts.pollMs || 60 * 1000; // default once per minute
  if (_interval) clearInterval(_interval);
  _interval = setInterval(() => {
    processHives().catch((e) =>
      logger.error('Hive worker run failed', { error: e && (e.stack || e) })
    );
  }, pollMs);
  logger.info('Hive worker started', { pollMs });
  try {
    const systemMonitor = utils.systemMonitor;
    systemMonitor.registerSystem('hiveWorker', { name: 'Hive Worker', shutdown: stop });
  } catch (e) {
    logger.warn('Failed registering hiveWorker with systemMonitor', { error: e && (e.stack || e) });
  }
}

async function stop() {
  try {
    if (_interval) clearInterval(_interval);
    _interval = null;
    logger.info('Hive worker stopped');
  } catch (e) {
    logger.warn('Failed stopping hive worker', { error: e && (e.stack || e) });
  }
}

module.exports = { start, stop, processHives };
