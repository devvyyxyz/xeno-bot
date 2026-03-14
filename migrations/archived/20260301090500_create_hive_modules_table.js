exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('hive_modules');
  if (exists) return;
  return knex.schema.createTable('hive_modules', (table) => {
    table.increments('id').primary();
    table.integer('hive_id').notNullable().references('id').inTable('hives').onDelete('CASCADE');
    table.string('module_key').notNullable();
    table.integer('level').defaultTo(0);
    table.json('data').nullable();
    table.timestamps(true, true);
    table.unique(['hive_id', 'module_key']);
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('hive_modules');
  if (!exists) return;
  return knex.schema.dropTable('hive_modules');
};
