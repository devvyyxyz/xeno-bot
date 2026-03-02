const db = require('../db');
const logger = require('../utils/logger').get('models:egg');

// Ensure all eggs from config are present in the database for all guilds
async function ensureAllEggsInAllGuilds(eggTypes, knexInstance = db.knex) {
  await ensureEggStatsTable();
  const eggIds = Array.isArray(eggTypes) ? eggTypes.map(e => e && e.id).filter(Boolean) : [];
  if (eggIds.length === 0) return;

  const guildRows = await knexInstance('guild_settings').select('guild_id');
  const batchSize = Number(process.env.EGG_STATS_SYNC_BATCH_SIZE) || 500;
  const inserts = [];

  for (const row of guildRows) {
    const guildId = row.guild_id;
    if (!guildId) continue;
    for (const eggId of eggIds) {
      inserts.push({ egg_id: eggId, guild_id: guildId, caught: 0 });
    }
  }

  let attempted = 0;
  for (let i = 0; i < inserts.length; i += batchSize) {
    const batch = inserts.slice(i, i + batchSize);
    attempted += batch.length;
    try {
      await knexInstance('egg_stats').insert(batch).onConflict(['egg_id', 'guild_id']).ignore();
    } catch (err) {
      // Fallback for databases/drivers that don't support onConflict().ignore() reliably
      for (const row of batch) {
        try {
          await knexInstance('egg_stats').insert(row);
        } catch (innerErr) {
          const msg = String((innerErr && (innerErr.message || innerErr.stack)) || '').toLowerCase();
          if (!msg.includes('duplicate') && !msg.includes('unique')) throw innerErr;
        }
      }
    }
  }

  logger.info('Egg stats synchronization completed', {
    guilds: guildRows.length,
    eggTypes: eggIds.length,
    attemptedRows: attempted,
    batchSize
  });
}

// Ensure the egg_stats table exists
async function ensureEggStatsTable() {
  const exists = await db.knex.schema.hasTable('egg_stats');
  if (!exists) {
    await db.knex.schema.createTable('egg_stats', (table) => {
      table.increments('id').primary();
      table.string('egg_id').notNullable();
      table.string('guild_id').notNullable();
      table.integer('caught').defaultTo(0);
      table.unique(['egg_id', 'guild_id']);
    });
    logger.info('Created `egg_stats` table');
  }
}

// Ensure the egg_catches table exists for recording individual catch events
async function ensureEggCatchesTable() {
  const exists = await db.knex.schema.hasTable('egg_catches');
  if (!exists) {
    await db.knex.schema.createTable('egg_catches', (table) => {
      table.increments('id').primary();
      table.string('egg_id').notNullable();
      table.string('guild_id').notNullable();
      table.string('user_id').notNullable();
      table.integer('amount').defaultTo(1);
      table.timestamp('caught_at').defaultTo(db.knex.fn.now());
    });
    logger.info('Created `egg_catches` table');
  }
}

// Ensure all egg types exist in the table for a guild
async function ensureEggTypesForGuild(guildId, eggTypes) {
  await ensureEggStatsTable();
  for (const egg of eggTypes) {
    const exists = await db.knex('egg_stats').where({ egg_id: egg.id, guild_id: guildId }).first();
    if (!exists) {
      await db.knex('egg_stats').insert({ egg_id: egg.id, guild_id: guildId, caught: 0 });
      logger.info('Inserted egg stat row', { egg_id: egg.id, guild_id: guildId });
    }
  }
}

// Increment caught count for an egg type in a guild
async function incrementEggCaught(guildId, eggId, amount = 1) {
  await ensureEggStatsTable();
  await db.knex('egg_stats')
    .where({ egg_id: eggId, guild_id: guildId })
    .increment('caught', amount);
}

// Record an egg catch event: increment aggregates and store an event row
async function recordEggCatch(guildId, eggId, userId, amount = 1) {
  await ensureEggStatsTable();
  await ensureEggCatchesTable();
  // update aggregate
  await db.knex('egg_stats')
    .where({ egg_id: eggId, guild_id: guildId })
    .increment('caught', amount);
  // insert event row
  await db.knex('egg_catches').insert({ egg_id: eggId, guild_id: guildId, user_id: String(userId), amount: Number(amount || 1) });
}

// Get all egg stats for a guild
async function getEggStatsForGuild(guildId) {
  await ensureEggStatsTable();
  const rows = await db.knex('egg_stats').where({ guild_id: guildId });
  const stats = {};
  for (const row of rows) {
    stats[row.egg_id] = row.caught;
  }
  return stats;
}

module.exports = {
  ensureEggStatsTable,
  ensureEggTypesForGuild,
  incrementEggCaught,
  recordEggCatch,
  getEggStatsForGuild,
  ensureAllEggsInAllGuilds,
};
