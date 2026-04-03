const db = require('./db');
const utils = require('./utils');
const baseLogger = utils.logger;
const logger = baseLogger.get('hiveWorker');
const models = require('./models');
const userModel = models.user;
const hiveModel = models.hive;
const { safeJsonParse, safeLogMemory } = require('./lib/safeUtils');

let _interval = null;
let shuttingDown = false;

async function processHives() {
  if (shuttingDown) return 0;
  try {
    // Snapshot memory for diagnostics
    safeLogMemory(logger, 'processHives memory start');
    const now = Date.now();
    const msPerHour = 3600000;
    // Process hives in chunks using keyset pagination (id > lastId) to avoid
    // expensive OFFSET scans on large tables. Select only required columns
    // to reduce memory pressure.
    const chunkSize = Number(process.env.HIVE_WORKER_CHUNK_SIZE) || 200;
    let lastId = 0;
    let processed = 0;
    const awardedHives = [];
    while (true) {
      const rows = await db.knex('hives')
        .where('jelly_production_per_hour', '>', 0)
        .andWhere('id', '>', lastId)
        .select('id', 'user_id', 'owner_discord_id', 'guild_id', 'jelly_production_per_hour', 'data', 'created_at')
        .orderBy('id', 'asc')
        .limit(chunkSize);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
      try {
        const hive = r;
        const ownerId = String(hive.user_id || hive.owner_discord_id || '');
        const guildId = hive.guild_id || null;
        const rate = Number(hive.jelly_production_per_hour || 0);
        if (!rate || rate <= 0) continue;
        // determine last_collected timestamp from data JSON
        const data = safeJsonParse(hive.data, {}, logger);
        const lastCollected =
          Number(data && data.last_collected_at) || Number(hive.created_at) || now;
        const elapsedMs = Math.max(0, now - lastCollected);
        // compute amount to award
        const amount = Math.floor((elapsedMs * rate) / msPerHour);
        if (amount > 0) {
          try {
            await userModel.modifyCurrencyForGuild(ownerId, guildId, 'royal_jelly', Number(amount));
            // advance last_collected by the amount awarded
            const consumedMs = Math.floor((amount * msPerHour) / rate);
            const newLast = lastCollected + consumedMs;
            const newData = Object.assign({}, data, { last_collected_at: newLast });
            await hiveModel.updateHiveById(hive.id, { data: newData }, { quiet: true });
            awardedHives.push({ hiveId: hive.id, ownerId, guildId, amount });
            processed += 1;
          } catch (e) {
            logger.warn('Failed awarding and updating hive', {
              hiveId: hive.id,
              ownerId,
              guildId,
              amount,
              error: e && (e.stack || e),
            });
          }
        }
      } catch (e) {
        logger.warn('Failed processing hive row', { row: r && r.id, error: e && (e.stack || e) });
      }
      }
      // Advance keyset cursor to the last row processed
      const lastRow = rows[rows.length - 1];
      lastId = Number(lastRow && lastRow.id) || lastId;
      // small pause to give GC/event loop a chance to run between chunks
      await new Promise((res) => setTimeout(res, Number(process.env.HIVE_WORKER_CHUNK_DELAY_MS) || 20));
    }
    safeLogMemory(logger, 'processHives memory end');

    if (awardedHives.length > 0) {
      const totalHives = awardedHives.length;
      const totalAmount = awardedHives.reduce((s, a) => s + (Number(a.amount) || 0), 0);
      logger.info(`Awarded hive production x${totalHives} (+${totalAmount})`, { totalHives, totalAmount });
    }

    return processed;
  } catch (e) {
    logger.warn('Hive worker failed', { error: e && (e.stack || e) });
    return 0;
  }
}

async function start(opts = {}) {
  if (shuttingDown) {
    logger.info('Hive worker start called while shutting down; ignoring');
    return;
  }
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
  shuttingDown = true;
  try {
    if (_interval) clearInterval(_interval);
    _interval = null;
    logger.info('Hive worker stopped');
  } catch (e) {
    logger.warn('Failed stopping hive worker', { error: e && (e.stack || e) });
  }
}

module.exports = { start, stop, processHives };
