const Knex = require('knex');
const knexfile = require('../knexfile');

async function main() {
  const env = process.env.NODE_ENV || 'production';
  const cfg = knexfile[env] || knexfile.production;
  const knex = Knex(cfg);
  try {
    const hasTable = await knex.schema.hasTable('xenomorphs');
    if (!hasTable) {
      console.error('Table `xenomorphs` does not exist in target DB. Aborting.');
      process.exit(2);
    }

    const hasCol = await knex.schema.hasColumn('xenomorphs', 'guild_id');
    if (!hasCol) {
      console.log('Adding `guild_id` column to `xenomorphs`...');
      await knex.schema.alterTable('xenomorphs', (table) => {
        table.string('guild_id', 255).nullable().index();
      });
      console.log('Added `guild_id`.');
    } else {
      console.log('`guild_id` already exists on `xenomorphs`.');
    }

    // Populate guild_id from hives
    console.log('Populating guild_id from hives for rows with hive_id...');
    await knex.raw(`
      UPDATE xenomorphs x
      JOIN hives h ON x.hive_id = h.id
      SET x.guild_id = h.guild_id
      WHERE x.guild_id IS NULL AND x.hive_id IS NOT NULL
    `);

    console.log('Populating guild_id for rows without hive_id using first hive owned by user...');
    await knex.raw(`
      UPDATE xenomorphs x
      JOIN (
        SELECT user_id AS owner_id, MIN(id) AS hive_id FROM hives GROUP BY user_id
      ) hmin ON x.owner_id = hmin.owner_id
      JOIN hives h2 ON hmin.hive_id = h2.id
      SET x.guild_id = h2.guild_id
      WHERE x.guild_id IS NULL AND x.hive_id IS NULL
    `);

    console.log('Done populating guild_id.');
    await knex.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Operation failed:', err && (err.message || err));
    try { await knex.destroy(); } catch (_) {}
    process.exit(1);
  }
}

main();
