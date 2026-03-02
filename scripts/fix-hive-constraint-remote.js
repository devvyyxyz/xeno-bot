/*
Script to fix the hives table constraint on remote MySQL database
This removes the old unique constraint on user_id only and adds a composite unique on (user_id, guild_id)

Usage:
  DATABASE_URL="mysql://user:pass@host:port/dbname" node scripts/fix-hive-constraint-remote.js
*/

const mysql = require('mysql2/promise');

async function fixConstraint() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.error('Usage: DATABASE_URL="mysql://..." node scripts/fix-hive-constraint-remote.js');
    process.exit(1);
  }

  console.log('🔧 Connecting to remote database...');
  
  let connection;
  try {
    connection = await mysql.createConnection(dbUrl);
    console.log('✅ Connected to database');

    // Check current table structure
    console.log('\n📋 Current hives table structure:');
    const [indexes] = await connection.query('SHOW INDEX FROM hives WHERE Key_name LIKE "%user%"');
    console.table(indexes.map(idx => ({
      Key_name: idx.Key_name,
      Column_name: idx.Column_name,
      Non_unique: idx.Non_unique
    })));

    // Check if guild_id column exists
    const [columns] = await connection.query("SHOW COLUMNS FROM hives WHERE Field = 'guild_id'");
    if (columns.length === 0) {
      console.log('\n⚠️  guild_id column does not exist, adding it...');
      await connection.query('ALTER TABLE hives ADD COLUMN guild_id VARCHAR(255) NULL AFTER user_id');
      console.log('✅ Added guild_id column');
    } else {
      console.log('✅ guild_id column exists');
    }

    // Check if we need to populate guild_id for existing hives
    const [nullCount] = await connection.query('SELECT COUNT(*) as count FROM hives WHERE guild_id IS NULL');
    if (nullCount[0].count > 0) {
      console.log(`\n⚠️  Found ${nullCount[0].count} hives with NULL guild_id`);
      console.log('Attempting to populate from users data...');
      
      const [hivesWithNull] = await connection.query('SELECT id, user_id FROM hives WHERE guild_id IS NULL');
      let populated = 0;
      
      for (const hive of hivesWithNull) {
        // Try to get user's first guild from their data
        const [users] = await connection.query('SELECT data FROM users WHERE discord_id = ? OR id = ?', [hive.user_id, hive.user_id]);
        if (users.length > 0) {
          try {
            const userData = JSON.parse(users[0].data || '{}');
            const guildIds = Object.keys(userData.guilds || {});
            if (guildIds.length > 0) {
              await connection.query('UPDATE hives SET guild_id = ? WHERE id = ?', [guildIds[0], hive.id]);
              populated++;
            }
          } catch (e) {
            console.warn(`  Failed to parse user data for hive ${hive.id}`);
          }
        }
      }
      
      console.log(`✅ Populated guild_id for ${populated} hives`);
      
      // Check if any still remain NULL
      const [stillNull] = await connection.query('SELECT COUNT(*) as count FROM hives WHERE guild_id IS NULL');
      if (stillNull[0].count > 0) {
        console.error(`\n❌ ${stillNull[0].count} hives still have NULL guild_id`);
        console.error('Manual intervention required. Cannot proceed with making guild_id NOT NULL.');
        process.exit(1);
      }
    }

    // Drop the old unique constraint on user_id only
    console.log('\n🔄 Removing old unique constraint on user_id...');
    try {
      await connection.query('ALTER TABLE hives DROP INDEX hives_user_id_unique');
      console.log('✅ Dropped hives_user_id_unique constraint');
    } catch (e) {
      if (e.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
        console.log('ℹ️  Constraint hives_user_id_unique does not exist or already dropped');
      }
    }

    // Try alternative constraint names
    try {
      await connection.query('ALTER TABLE hives DROP INDEX user_id');
      console.log('✅ Dropped user_id unique index');
    } catch (e) {
      console.log('ℹ️  Index user_id does not exist or already dropped');
    }

    // Make guild_id NOT NULL
    console.log('\n🔄 Making guild_id NOT NULL...');
    await connection.query('ALTER TABLE hives MODIFY guild_id VARCHAR(255) NOT NULL');
    console.log('✅ guild_id is now NOT NULL');

    // Add composite unique constraint
    console.log('\n🔄 Adding composite unique constraint on (user_id, guild_id)...');
    try {
      await connection.query('ALTER TABLE hives ADD UNIQUE INDEX hives_user_guild_unique (user_id, guild_id)');
      console.log('✅ Added composite unique constraint');
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') {
        console.log('ℹ️  Composite constraint already exists');
      } else {
        throw e;
      }
    }

    // Show final structure
    console.log('\n📋 Final hives table indexes:');
    const [finalIndexes] = await connection.query('SHOW INDEX FROM hives');
    console.table(finalIndexes.map(idx => ({
      Key_name: idx.Key_name,
      Column_name: idx.Column_name,
      Non_unique: idx.Non_unique,
      Seq: idx.Seq_in_index
    })));

    console.log('\n✅ Migration complete! Users can now create one hive per server.');

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

fixConstraint().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
