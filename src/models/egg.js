// Ensure all eggs from config are present in the database for all guilds
async function ensureAllEggsInAllGuilds(eggTypes, knexInstance = knex) {
  await ensureEggStatsTable();
  // Get all guild IDs from guild_settings table
  const guildRows = await knexInstance('guild_settings').select('guild_id');
  for (const row of guildRows) {
    const guildId = row.guild_id;
    for (const egg of eggTypes) {
      const exists = await knexInstance('egg_stats').where({ egg_id: egg.id, guild_id: guildId }).first();
      if (!exists) {
        await knexInstance('egg_stats').insert({ egg_id: egg.id, guild_id: guildId, caught: 0 });
        logger.info('Inserted egg stat row', { egg_id: egg.id, guild_id: guildId });
      }
    }
  }
}
const { knex } = require('../db');
const logger = require('../utils/logger').get('models:egg');

// Ensure the egg_stats table exists
async function ensureEggStatsTable() {
  const exists = await knex.schema.hasTable('egg_stats');
  if (!exists) {
    await knex.schema.createTable('egg_stats', (table) => {
      table.increments('id').primary();
      table.string('egg_id').notNullable();
      table.string('guild_id').notNullable();
      table.integer('caught').defaultTo(0);
      table.unique(['egg_id', 'guild_id']);
    });
    logger.info('Created `egg_stats` table');
  }
}

// Ensure all egg types exist in the table for a guild
async function ensureEggTypesForGuild(guildId, eggTypes) {
  await ensureEggStatsTable();
  for (const egg of eggTypes) {
    const exists = await knex('egg_stats').where({ egg_id: egg.id, guild_id: guildId }).first();
    if (!exists) {
      await knex('egg_stats').insert({ egg_id: egg.id, guild_id: guildId, caught: 0 });
      logger.info('Inserted egg stat row', { egg_id: egg.id, guild_id: guildId });
    }
  }
}

// Increment caught count for an egg type in a guild
async function incrementEggCaught(guildId, eggId, amount = 1) {
  await ensureEggStatsTable();
  await knex('egg_stats')
    .where({ egg_id: eggId, guild_id: guildId })
    .increment('caught', amount);
}

// Get all egg stats for a guild
async function getEggStatsForGuild(guildId) {
  await ensureEggStatsTable();
  const rows = await knex('egg_stats').where({ guild_id: guildId });
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
  getEggStatsForGuild,
  ensureAllEggsInAllGuilds,
};
