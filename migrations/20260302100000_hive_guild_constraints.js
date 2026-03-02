/*
Migration: Update hives table constraints for per-guild hives
- Change guild_id from nullable to NOT NULL
- Drop unique constraint on user_id
- Add composite unique constraint on (user_id, guild_id)

IMPORTANT: Run scripts/migrate-hives-add-guild-id.js BEFORE this migration
           to populate guild_id for existing hives!
*/

exports.up = async function(knex) {
  const client = knex.client.config.client;
  
  if (client === 'sqlite3') {
    // SQLite doesn't support ALTER COLUMN or DROP CONSTRAINT directly
    // We need to recreate the table
    
    // 1. Create new table with correct constraints
    await knex.schema.createTable('hives_new', table => {
      table.increments('id').primary();
      table.string('user_id', 255).notNullable(); // Keep user_id, not owner_discord_id
      table.string('guild_id', 255).notNullable(); // NOW NOT NULL
      table.string('name', 100).defaultTo('My Hive');
      table.string('hive_type', 50).defaultTo('default'); // Keep hive_type, not type
      table.string('queen_xeno_id', 255);
      table.integer('capacity').defaultTo(5);
      table.float('jelly_production_per_hour').defaultTo(0);
      table.json('data');
      table.timestamps(true, true);
      
      // Composite unique: one hive per user per guild
      table.unique(['user_id', 'guild_id']);
    });
    
    // 2. Copy data from old table
    await knex.raw(`
      INSERT INTO hives_new (id, user_id, guild_id, name, hive_type, queen_xeno_id, capacity, jelly_production_per_hour, data, created_at, updated_at)
      SELECT id, user_id, guild_id, name, hive_type, queen_xeno_id, capacity, jelly_production_per_hour, data, created_at, updated_at
      FROM hives
    `);
    
    // 3. Drop old table
    await knex.schema.dropTable('hives');
    
    // 4. Rename new table
    await knex.schema.renameTable('hives_new', 'hives');
    
  } else if (client === 'pg') {
    // PostgreSQL
    
    // 1. Make guild_id NOT NULL
    await knex.schema.alterTable('hives', table => {
      table.string('guild_id', 255).notNullable().alter();
    });
    
    // 2. Drop the unique constraint on user_id
    // Need to find the constraint name first
    const constraints = await knex.raw(`
      SELECT conname FROM pg_constraint 
      WHERE conrelid = 'hives'::regclass 
      AND contype = 'u' 
      AND conkey = (SELECT array_agg(attnum) FROM pg_attribute WHERE attrelid = 'hives'::regclass AND attname = 'user_id')
    `);
    
    if (constraints.rows && constraints.rows.length > 0) {
      const constraintName = constraints.rows[0].conname;
      await knex.raw(`ALTER TABLE hives DROP CONSTRAINT ${constraintName}`);
    }
    
    // 3. Add composite unique constraint
    await knex.schema.alterTable('hives', table => {
      table.unique(['user_id', 'guild_id']);
    });
    
  } else if (client === 'mysql2' || client === 'mysql') {
    // MySQL
    
    // 1. Drop unique key on user_id
    await knex.raw(`ALTER TABLE hives DROP INDEX user_id`);
    
    // 2. Make guild_id NOT NULL
    await knex.schema.alterTable('hives', table => {
      table.string('guild_id', 255).notNullable().alter();
    });
    
    // 3. Add composite unique index
    await knex.raw(`ALTER TABLE hives ADD UNIQUE INDEX hives_user_guild_unique (user_id, guild_id)`);
  }
  
  console.log('✅ Hives table constraints updated for per-guild hives');
};

exports.down = async function(knex) {
  const client = knex.client.config.client;
  
  if (client === 'sqlite3') {
    // Recreate original table structure
    await knex.schema.createTable('hives_old', table => {
      table.increments('id').primary();
      table.string('user_id', 255).notNullable().unique();
      table.string('guild_id', 255).nullable(); // Back to nullable
      table.string('name', 100).defaultTo('My Hive');
      table.string('hive_type', 50).defaultTo('default');
      table.string('queen_xeno_id', 255);
      table.integer('capacity').defaultTo(5);
      table.float('jelly_production_per_hour').defaultTo(0);
      table.json('data');
      table.timestamps(true, true);
    });
    
    // Copy data
    await knex.raw(`
      INSERT INTO hives_old (id, user_id, guild_id, name, hive_type, queen_xeno_id, capacity, jelly_production_per_hour, data, created_at, updated_at)
      SELECT id, user_id, guild_id, name, hive_type, queen_xeno_id, capacity, jelly_production_per_hour, data, created_at, updated_at
      FROM hives
    `);
    
    await knex.schema.dropTable('hives');
    await knex.schema.renameTable('hives_old', 'hives');
    
  } else if (client === 'pg') {
    // Drop composite unique constraint
    const constraints = await knex.raw(`
      SELECT conname FROM pg_constraint 
      WHERE conrelid = 'hives'::regclass 
      AND contype = 'u' 
      AND array_length(conkey, 1) = 2
    `);
    
    if (constraints.rows && constraints.rows.length > 0) {
      const constraintName = constraints.rows[0].conname;
      await knex.raw(`ALTER TABLE hives DROP CONSTRAINT ${constraintName}`);
    }
    
    // Add back unique on user_id only
    await knex.schema.alterTable('hives', table => {
      table.unique(['user_id']);
    });
    
    // Make guild_id nullable again
    await knex.schema.alterTable('hives', table => {
      table.string('guild_id', 255).nullable().alter();
    });
    
  } else if (client === 'mysql2' || client === 'mysql') {
    // Drop composite unique
    await knex.raw(`ALTER TABLE hives DROP INDEX hives_user_guild_unique`);
    
    // Make guild_id nullable
    await knex.schema.alterTable('hives', table => {
      table.string('guild_id', 255).nullable().alter();
    });
    
    // Add back unique on user_id
    await knex.raw(`ALTER TABLE hives ADD UNIQUE INDEX user_id (user_id)`);
  }
  
  console.log('⚠️  Rolled back hives table to global (single hive per user)');
};
