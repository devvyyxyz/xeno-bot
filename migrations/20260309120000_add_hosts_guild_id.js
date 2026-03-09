exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('hosts');
  if (!exists) return;
  const has = await knex.schema.hasColumn('hosts', 'guild_id');
  if (!has) {
    return knex.schema.alterTable('hosts', (table) => {
      table.string('guild_id').nullable().index();
    });
  }
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('hosts');
  if (!exists) return;
  const has = await knex.schema.hasColumn('hosts', 'guild_id');
  if (has) {
    return knex.schema.alterTable('hosts', (table) => {
      table.dropColumn('guild_id');
    });
  }
};
