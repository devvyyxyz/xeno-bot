exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('gambling_plays');
  if (exists) return;
  return knex.schema.createTable('gambling_plays', (table) => {
    table.increments('id').primary();
    table.string('user_id').notNullable().index();
    table.string('guild_id').nullable().index();
    table.string('game').notNullable();
    table.bigInteger('bet').defaultTo(0);
    table.bigInteger('payout').defaultTo(0);
    table.integer('multiplier').defaultTo(0);
    table.string('result').nullable();
    table.bigInteger('created_at').notNullable();
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('gambling_plays');
  if (!exists) return;
  return knex.schema.dropTable('gambling_plays');
};
