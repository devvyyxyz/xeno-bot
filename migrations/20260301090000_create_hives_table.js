exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('hives');
  if (exists) return;
  return knex.schema.createTable('hives', (table) => {
    table.increments('id').primary();
    table.string('owner_discord_id').notNullable().unique();
    table.string('guild_id').nullable();
    table.string('name').defaultTo('My Hive');
    table.string('type').defaultTo('default');
    table.string('queen_xeno_id').nullable();
    table.integer('capacity').defaultTo(5);
    table.float('jelly_production_per_hour').defaultTo(0);
    table.json('data').nullable();
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('hives');
  if (!exists) return;
  return knex.schema.dropTable('hives');
};
