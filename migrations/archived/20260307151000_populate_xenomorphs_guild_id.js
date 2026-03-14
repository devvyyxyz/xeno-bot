exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('xenomorphs');
  if (!exists) return;
  const has = await knex.schema.hasColumn('xenomorphs', 'guild_id');
  if (!has) return;

  const client = knex.client.config.client;

  if (client === 'sqlite3') {
    // 1) Populate from explicit hive_id
    await knex.raw(`
      UPDATE xenomorphs
      SET guild_id = (SELECT guild_id FROM hives WHERE hives.id = xenomorphs.hive_id)
      WHERE guild_id IS NULL AND hive_id IS NOT NULL
    `);

    // 2) For xenos without hive_id, try to use any hive owned by the same owner (first by id)
    // Note: hives table stores the owner as `user_id`.
    await knex.raw(`
      UPDATE xenomorphs
      SET guild_id = (
        SELECT guild_id FROM hives WHERE hives.user_id = xenomorphs.owner_id ORDER BY id LIMIT 1
      )
      WHERE guild_id IS NULL AND hive_id IS NULL
    `);

  } else if (client === 'pg') {
    // PostgreSQL: use FROM joins
    await knex.raw(`
      UPDATE xenomorphs
      SET guild_id = h.guild_id
      FROM hives h
      WHERE xenomorphs.hive_id = h.id AND xenomorphs.guild_id IS NULL AND xenomorphs.hive_id IS NOT NULL
    `);

    await knex.raw(`
      UPDATE xenomorphs
      SET guild_id = h2.guild_id
      FROM (
        SELECT user_id AS owner_id, MIN(id) AS hive_id FROM hives GROUP BY user_id
      ) hmin
      JOIN hives h2 ON hmin.hive_id = h2.id
      WHERE xenomorphs.owner_id = hmin.owner_id AND xenomorphs.guild_id IS NULL AND xenomorphs.hive_id IS NULL
    `);

  } else if (client === 'mysql' || client === 'mysql2') {
    // MySQL: use JOINs
    await knex.raw(`
      UPDATE xenomorphs x
      JOIN hives h ON x.hive_id = h.id
      SET x.guild_id = h.guild_id
      WHERE x.guild_id IS NULL AND x.hive_id IS NOT NULL
    `);

    await knex.raw(`
      UPDATE xenomorphs x
      JOIN (
        SELECT user_id AS owner_id, MIN(id) AS hive_id FROM hives GROUP BY user_id
      ) hmin ON x.owner_id = hmin.owner_id
      JOIN hives h2 ON hmin.hive_id = h2.id
      SET x.guild_id = h2.guild_id
      WHERE x.guild_id IS NULL AND x.hive_id IS NULL
    `);
  }

  console.log('✅ Populated xenomorphs.guild_id where derivable from hives');
};

exports.down = async function(knex) {
  // This migration is intentionally non-destructive to existing data. Reverting would remove
  // guild context from xenomorphs that may have been actively used. No-op.
  return Promise.resolve();
};
