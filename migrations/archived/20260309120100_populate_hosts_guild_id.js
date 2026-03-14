exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('hosts');
  if (!exists) return;

  const client = (knex.client && knex.client.config && knex.client.config.client) || '';

  try {
    // 1) Backfill from JSON `data` -> guild_id when present
    if (client === 'pg' || client === 'postgres') {
      await knex.raw(`
        UPDATE hosts
        SET guild_id = (data::json ->> 'guild_id')
        WHERE (guild_id IS NULL OR guild_id = '')
          AND data IS NOT NULL
          AND (data::json ->> 'guild_id') IS NOT NULL
      `);
    } else if (client === 'sqlite3') {
      await knex.raw(`
        UPDATE hosts
        SET guild_id = json_extract(data, '$.guild_id')
        WHERE (guild_id IS NULL OR guild_id = '')
          AND data IS NOT NULL
          AND json_extract(data, '$.guild_id') IS NOT NULL
      `);
    } else {
      // MySQL / MariaDB
      try {
        await knex.raw(`
          UPDATE hosts
          SET guild_id = JSON_UNQUOTE(JSON_EXTRACT(data, '$.guild_id'))
          WHERE (guild_id IS NULL OR guild_id = '')
            AND data IS NOT NULL
            AND JSON_EXTRACT(data, '$.guild_id') IS NOT NULL
        `);
      } catch (e) {
        // best-effort only
      }
    }
  } catch (e) {
    // continue even if backfill fails for some DBs
    console.warn('hosts guild_id backfill warning', e && e.message);
  }

  // 2) If there are no remaining NULL/empty guild_id rows, make column NOT NULL
  try {
    const [{ cnt } = { cnt: 0 }] = await knex('hosts').whereRaw("guild_id IS NULL OR guild_id = ''").count('* as cnt');
    if (Number(cnt || 0) === 0) {
      // alter to not nullable
      await knex.schema.alterTable('hosts', (table) => {
        table.string('guild_id', 255).notNullable().alter();
      });
    } else {
      console.warn('Skipping making hosts.guild_id NOT NULL - remaining unset rows:', cnt);
    }
  } catch (e) {
    console.warn('Could not alter hosts.guild_id to NOT NULL', e && e.message);
  }
};

exports.down = async function(knex) {
  // No-op for down: we keep the column for safety. If desired, the column can be dropped.
};
