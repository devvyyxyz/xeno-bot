/*
Migration: Add performance indexes for high-traffic queries
These indexes will significantly speed up common operations at scale
*/

exports.up = async function(knex) {
  const client = knex.client.config.client;
  
  console.log('📊 Adding performance indexes for scalability...');
  
  // Users table indexes
  if (await knex.schema.hasTable('users')) {
    console.log('  Adding indexes to users table...');
    
    // Index for discord_id lookups (already unique, but ensure it exists)
    // Most queries fetch users by discord_id
    
    // Index for sorting by created_at (leaderboards, activity tracking)
    if (!(await knex.schema.hasColumn('users', 'created_at'))) {
      await knex.schema.alterTable('users', table => {
        if (client !== 'sqlite3') {
          table.index(['created_at'], 'idx_users_created_at');
        }
      });
    }
  }
  
  // Guild_settings table indexes
  if (await knex.schema.hasTable('guild_settings')) {
    console.log('  Adding indexes to guild_settings table...');
    
    // Index for finding enabled guilds quickly
    const hasEnabled = await knex.schema.hasColumn('guild_settings', 'enabled');
    if (hasEnabled) {
      await knex.schema.alterTable('guild_settings', table => {
        if (client === 'pg') {
          // PostgreSQL: create index on enabled guilds
          knex.raw('CREATE INDEX IF NOT EXISTS idx_guild_enabled ON guild_settings(enabled) WHERE enabled = true');
        } else if (client !== 'sqlite3') {
          table.index(['enabled'], 'idx_guild_enabled');
        }
      });
    }
  }
  
  // Hives table indexes
  if (await knex.schema.hasTable('hives')) {
    console.log('  Adding indexes to hives table...');
    
    // Index for guild_id lookups (find all hives in a guild)
    const hasGuildId = await knex.schema.hasColumn('hives', 'guild_id');
    if (hasGuildId) {
      await knex.schema.alterTable('hives', table => {
        if (client !== 'sqlite3') {
          table.index(['guild_id'], 'idx_hives_guild_id');
        }
      });
    }
    
    // Index for queen_xeno_id lookups
    const hasQueenId = await knex.schema.hasColumn('hives', 'queen_xeno_id');
    if (hasQueenId) {
      await knex.schema.alterTable('hives', table => {
        if (client !== 'sqlite3') {
          table.index(['queen_xeno_id'], 'idx_hives_queen_xeno_id');
        }
      });
    }
  }
  
  // Xenomorphs table indexes
  if (await knex.schema.hasTable('xenomorphs')) {
    console.log('  Adding indexes to xenomorphs table...');
    
    // Composite index for owner + stage queries (common for filtering)
    const hasStage = await knex.schema.hasColumn('xenomorphs', 'stage');
    const hasOwnerId = await knex.schema.hasColumn('xenomorphs', 'owner_id');
    if (hasStage && hasOwnerId) {
      await knex.schema.alterTable('xenomorphs', table => {
        if (client !== 'sqlite3') {
          table.index(['owner_id', 'stage'], 'idx_xenomorphs_owner_stage');
        }
      });
    }
    
    // Index for role-based queries (finding specific castes)
    const hasRole = await knex.schema.hasColumn('xenomorphs', 'role');
    if (hasRole && hasOwnerId) {
      await knex.schema.alterTable('xenomorphs', table => {
        if (client !== 'sqlite3') {
          table.index(['owner_id', 'role'], 'idx_xenomorphs_owner_role');
        }
      });
    }
    
    // Index for hive_id lookups (all xenos in a hive)
    const hasHiveId = await knex.schema.hasColumn('xenomorphs', 'hive_id');
    if (hasHiveId) {
      await knex.schema.alterTable('xenomorphs', table => {
        if (client !== 'sqlite3') {
          table.index(['hive_id'], 'idx_xenomorphs_hive_id');
        }
      });
    }
  }
  
  // Hosts table indexes
  if (await knex.schema.hasTable('hosts')) {
    console.log('  Adding indexes to hosts table...');
    
    // Composite index for owner + host_type queries
    const hasHostType = await knex.schema.hasColumn('hosts', 'host_type');
    const hasOwnerId = await knex.schema.hasColumn('hosts', 'owner_id');
    if (hasHostType && hasOwnerId) {
      await knex.schema.alterTable('hosts', table => {
        if (client !== 'sqlite3') {
          table.index(['owner_id', 'host_type'], 'idx_hosts_owner_type');
        }
      });
    }
    
    // Index for rarity-based queries (leaderboards, stats)
    const hasRarity = await knex.schema.hasColumn('hosts', 'rarity');
    if (hasRarity) {
      await knex.schema.alterTable('hosts', table => {
        if (client !== 'sqlite3') {
          table.index(['rarity'], 'idx_hosts_rarity');
        }
      });
    }
  }
  
  // Active_spawns table indexes
  if (await knex.schema.hasTable('active_spawns')) {
    console.log('  Adding indexes to active_spawns table...');
    
    // Index for guild_id lookups (finding active spawns per guild)
    const hasGuildId = await knex.schema.hasColumn('active_spawns', 'guild_id');
    if (hasGuildId) {
      await knex.schema.alterTable('active_spawns', table => {
        if (client !== 'sqlite3') {
          table.index(['guild_id'], 'idx_active_spawns_guild');
        }
      });
    }
    
    // Composite index for channel + message lookups
    const hasChannelId = await knex.schema.hasColumn('active_spawns', 'channel_id');
    const hasMessageId = await knex.schema.hasColumn('active_spawns', 'message_id');
    if (hasChannelId && hasMessageId) {
      await knex.schema.alterTable('active_spawns', table => {
        if (client !== 'sqlite3') {
          table.index(['channel_id', 'message_id'], 'idx_active_spawns_channel_msg');
        }
      });
    }
    
    // Index for spawned_at to find old/expired spawns
    const hasSpawnedAt = await knex.schema.hasColumn('active_spawns', 'spawned_at');
    if (hasSpawnedAt) {
      await knex.schema.alterTable('active_spawns', table => {
        if (client !== 'sqlite3') {
          table.index(['spawned_at'], 'idx_active_spawns_spawned_at');
        }
      });
    }
  }
  
  // Evolution_queue table indexes
  if (await knex.schema.hasTable('evolution_queue')) {
    console.log('  Adding indexes to evolution_queue table...');
    
    // Composite index for user + status queries
    const hasUserId = await knex.schema.hasColumn('evolution_queue', 'user_id');
    const hasStatus = await knex.schema.hasColumn('evolution_queue', 'status');
    if (hasUserId && hasStatus) {
      await knex.schema.alterTable('evolution_queue', table => {
        if (client !== 'sqlite3') {
          table.index(['user_id', 'status'], 'idx_evolution_user_status');
        }
      });
    }
    
    // Index for finishes_at to process completed evolutions
    const hasFinishesAt = await knex.schema.hasColumn('evolution_queue', 'finishes_at');
    if (hasFinishesAt && hasStatus) {
      await knex.schema.alterTable('evolution_queue', table => {
        if (client !== 'sqlite3') {
          table.index(['status', 'finishes_at'], 'idx_evolution_status_finishes');
        }
      });
    }
  }
  
  // User_resources table indexes
  if (await knex.schema.hasTable('user_resources')) {
    console.log('  Adding indexes to user_resources table...');
    
    // Index for user_id lookups (primary access pattern)
    const hasUserId = await knex.schema.hasColumn('user_resources', 'user_id');
    if (hasUserId) {
      await knex.schema.alterTable('user_resources', table => {
        if (client !== 'sqlite3') {
          table.index(['user_id'], 'idx_user_resources_user_id');
        }
      });
    }
  }
  
  console.log('✅ Performance indexes added successfully');
};

exports.down = async function(knex) {
  const client = knex.client.config.client;
  
  console.log('🗑️  Removing performance indexes...');
  
  if (client === 'sqlite3') {
    console.log('  SQLite does not require explicit index drops on rollback');
    return;
  }
  
  // Drop all the indexes we created
  const indexesToDrop = [
    { table: 'users', index: 'idx_users_created_at' },
    { table: 'guild_settings', index: 'idx_guild_enabled' },
    { table: 'hives', index: 'idx_hives_guild_id' },
    { table: 'hives', index: 'idx_hives_queen_xeno_id' },
    { table: 'xenomorphs', index: 'idx_xenomorphs_owner_stage' },
    { table: 'xenomorphs', index: 'idx_xenomorphs_owner_role' },
    { table: 'xenomorphs', index: 'idx_xenomorphs_hive_id' },
    { table: 'hosts', index: 'idx_hosts_owner_type' },
    { table: 'hosts', index: 'idx_hosts_rarity' },
    { table: 'active_spawns', index: 'idx_active_spawns_guild' },
    { table: 'active_spawns', index: 'idx_active_spawns_channel_msg' },
    { table: 'active_spawns', index: 'idx_active_spawns_spawned_at' },
    { table: 'evolution_queue', index: 'idx_evolution_user_status' },
    { table: 'evolution_queue', index: 'idx_evolution_status_finishes' },
    { table: 'user_resources', index: 'idx_user_resources_user_id' }
  ];
  
  for (const { table, index } of indexesToDrop) {
    try {
      if (await knex.schema.hasTable(table)) {
        if (client === 'pg') {
          await knex.raw(`DROP INDEX IF EXISTS ${index}`);
        } else {
          await knex.schema.alterTable(table, t => {
            t.dropIndex([], index);
          });
        }
      }
    } catch (e) {
      console.log(`  Could not drop ${index}: ${e.message}`);
    }
  }
  
  console.log('⚠️  Rolled back performance indexes');
};
