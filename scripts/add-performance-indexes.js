/*
Direct script to add performance indexes to production database
Bypasses migration framework issues
*/

const mysql = require('mysql2/promise');

async function addIndexes() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('📊 Adding performance indexes to production database...\n');
  
  let connection;
  try {
    connection = await mysql.createConnection(dbUrl);
    console.log('✅ Connected to database\n');

    const indexes = [
      // Users table
      {
        table: 'users',
        name: 'idx_users_created_at',
        columns: ['created_at'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)'
      },
      
      // Hives table
      {
        table: 'hives',
        name: 'idx_hives_guild_id', 
        columns: ['guild_id'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_hives_guild_id ON hives(guild_id)'
      },
      {
        table: 'hives',
        name: 'idx_hives_queen_xeno_id',
        columns: ['queen_xeno_id'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_hives_queen_xeno_id ON hives(queen_xeno_id)'
      },
      
      // Xenomorphs table
      {
        table: 'xenomorphs',
        name: 'idx_xenomorphs_owner_stage',
        columns: ['owner_id', 'stage'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_xenomorphs_owner_stage ON xenomorphs(owner_id, stage)'
      },
      {
        table: 'xenomorphs',
        name: 'idx_xenomorphs_owner_role',
        columns: ['owner_id', 'role'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_xenomorphs_owner_role ON xenomorphs(owner_id, role)'
      },
      {
        table: 'xenomorphs',
        name: 'idx_xenomorphs_hive_id',
        columns: ['hive_id'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_xenomorphs_hive_id ON xenomorphs(hive_id)'
      },
      
      // Hosts table
      {
        table: 'hosts',
        name: 'idx_hosts_owner_type',
        columns: ['owner_id', 'host_type'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_hosts_owner_type ON hosts(owner_id, host_type)'
      },
      {
        table: 'hosts',
        name: 'idx_hosts_rarity',
        columns: ['rarity'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_hosts_rarity ON hosts(rarity)'
      },
      
      // Active_spawns table
      {
        table: 'active_spawns',
        name: 'idx_active_spawns_guild',
        columns: ['guild_id'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_active_spawns_guild ON active_spawns(guild_id)'
      },
      {
        table: 'active_spawns',
        name: 'idx_active_spawns_channel_msg',
        columns: ['channel_id', 'message_id'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_active_spawns_channel_msg ON active_spawns(channel_id, message_id)'
      },
      {
        table: 'active_spawns',
        name: 'idx_active_spawns_spawned_at',
        columns: ['spawned_at'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_active_spawns_spawned_at ON active_spawns(spawned_at)'
      },
      
      // Evolution_queue table
      {
        table: 'evolution_queue',
        name: 'idx_evolution_user_status',
        columns: ['user_id', 'status'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_evolution_user_status ON evolution_queue(user_id, status)'
      },
      {
        table: 'evolution_queue',
        name: 'idx_evolution_status_finishes',
        columns: ['status', 'finishes_at'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_evolution_status_finishes ON evolution_queue(status, finishes_at)'
      },
      
      // User_resources table
      {
        table: 'user_resources',
        name: 'idx_user_resources_user_id',
        columns: ['user_id'],
        sql: 'CREATE INDEX IF NOT EXISTS idx_user_resources_user_id ON user_resources(user_id)'
      }
    ];

    let added = 0;
    let skipped = 0;
    let errors = 0;

    for (const index of indexes) {
      try {
        // Check if table exists
        const [tables] = await connection.query(`SHOW TABLES LIKE '${index.table}'`);
        if (tables.length === 0) {
          console.log(`⚠️  Skipping ${index.name} - table ${index.table} does not exist`);
          skipped++;
          continue;
        }

        // Check if index already exists
        const [existingIndexes] = await connection.query(
          `SHOW INDEX FROM ${index.table} WHERE Key_name = ?`,
          [index.name]
        );

        if (existingIndexes.length > 0) {
          console.log(`ℹ️  ${index.name} already exists on ${index.table}`);
          skipped++;
          continue;
        }

        // Create index (MySQL doesn't support IF NOT EXISTS, so we handle errors)
        try {
          await connection.query(`CREATE INDEX ${index.name} ON ${index.table}(${index.columns.join(', ')})`);
          console.log(`✅ Created ${index.name} on ${index.table}(${index.columns.join(', ')})`);
          added++;
        } catch (err) {
          if (err.code === 'ER_DUP_KEYNAME') {
            console.log(`ℹ️  ${index.name} already exists (race condition)`);
            skipped++;
          } else {
            throw err;
          }
        }
      } catch (err) {
        console.error(`❌ Failed to create ${index.name}: ${err.message}`);
        errors++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`  ✅ Added: ${added}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Errors: ${errors}`);

    if (errors === 0) {
      console.log('\n🎉 All performance indexes successfully added!');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Disconnected from database');
    }
  }
}

addIndexes().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
