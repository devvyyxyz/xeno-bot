exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('hive_milestones');
  if (exists) return;
  return knex.schema.createTable('hive_milestones', (table) => {
    table.increments('id').primary();
    table.integer('hive_id').notNullable().references('id').inTable('hives').onDelete('CASCADE');
    table.string('milestone_key').notNullable();
    table.boolean('achieved').defaultTo(false);
    table.bigInteger('achieved_at').nullable();
    table.json('data').nullable();
    table.timestamps(true, true);
    table.unique(['hive_id', 'milestone_key']);
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('hive_milestones');
  if (!exists) return;
  return knex.schema.dropTable('hive_milestones');
};
