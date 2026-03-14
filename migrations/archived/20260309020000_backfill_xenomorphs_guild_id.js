exports.up = async function(knex) {
  // Backfill xenomorphs.guild_id where missing using hive join or JSON data
  const hasGuildCol = await knex.schema.hasColumn('xenomorphs', 'guild_id');
  if (!hasGuildCol) return;

  // 1) Set guild_id from hive join when hive_id is present
  await knex.raw(`
    UPDATE xenomorphs
    SET guild_id = h.guild_id
    FROM hives h
    WHERE xenomorphs.hive_id IS NOT NULL
      AND (xenomorphs.guild_id IS NULL OR xenomorphs.guild_id = '')
      AND h.id = xenomorphs.hive_id
  `);

  // 2) For remaining rows with null guild_id, attempt to parse JSON data->guild_id
  // Use a safe JSON extraction depending on DB; for Postgres -> jsonb
  try {
    // Postgres JSON path
    await knex.raw(`
      UPDATE xenomorphs
      SET guild_id = (xenomorphs.data::json ->> 'guild_id')
      WHERE (xenomorphs.guild_id IS NULL OR xenomorphs.guild_id = '')
        AND xenomorphs.data IS NOT NULL
        AND (xenomorphs.data::json ->> 'guild_id') IS NOT NULL
    `);
  } catch (e) {
    // If DB doesn't support JSON cast, try a conservative fallback (no-op)
  }

  return;
};

exports.down = async function(knex) {
  // We won't attempt to unset guild_id on rollback to avoid data loss.
  return Promise.resolve();
};
