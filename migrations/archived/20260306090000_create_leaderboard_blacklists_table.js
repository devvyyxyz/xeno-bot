exports.up = async function(knex) {
  await knex.schema.createTable('leaderboard_blacklists', table => {
    table.increments('id').primary();
    table.string('guild_id').notNullable().unique();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('leaderboard_blacklists');
};
