exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('hosts');
  if (exists) return;
  return knex.schema.createTable('hosts', (table) => {
    table.increments('id').primary();
    table.string('owner_id').notNullable().index();
    table.string('host_type').notNullable();
    table.bigInteger('found_at').notNullable();
    table.json('data').nullable();
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('hosts');
  if (!exists) return;
  return knex.schema.dropTable('hosts');
};
