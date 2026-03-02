/*
Migration script: populate guild_id for existing hives
Usage:
  node scripts/migrate-hives-add-guild-id.js [--apply]

Without --apply the script runs in dry-run mode and prints proposed changes.
With --apply it updates hives in the DB.

Strategy: For each hive with NULL guild_id, assign the first guild ID found in the owner's user data.
If no guilds found, the hive will remain NULL and may need manual intervention.
*/

const db = require('../src/db');

async function migrate(apply = false) {
  console.log('Starting hives guild_id migration. apply=', apply);
  
  // Initialize database connection
  await db.migrate();
  const knex = db.knex;
  
  // Get all hives with NULL guild_id (using user_id which is the actual column name)
  const hives = await knex('hives').select('id', 'user_id', 'guild_id').whereNull('guild_id');
  console.log(`Found ${hives.length} hives with NULL guild_id`);
  
  if (hives.length === 0) {
    console.log('No hives need migration.');
    return;
  }
  
  let updated = 0;
  let skipped = 0;
  
  for (const hive of hives) {
    // Get the user's data to find their guilds (try both user_id and discord_id)
    const userRows = await knex('users')
      .select('id', 'discord_id', 'data')
      .where('discord_id', hive.user_id)
      .orWhere('id', hive.user_id);
    
    if (userRows.length === 0) {
      console.warn(`⚠️  Hive ${hive.id} (owner ${hive.user_id}): User not found in DB`);
      skipped++;
      continue;
    }
    
    const userRow = userRows[0];
    let userData;
    try {
      userData = userRow.data ? JSON.parse(userRow.data) : {};
    } catch (e) {
      console.warn(`⚠️  Hive ${hive.id} (owner ${hive.user_id}): Failed to parse user data`);
      skipped++;
      continue;
    }
    
    // Get first guild ID from user's guilds
    const guilds = userData.guilds || {};
    const guildIds = Object.keys(guilds);
    
    if (guildIds.length === 0) {
      console.warn(`⚠️  Hive ${hive.id} (owner ${hive.user_id}): User has no guilds in data, cannot assign`);
      skipped++;
      continue;
    }
    
    const assignedGuildId = guildIds[0];
    console.log(`✓ Hive ${hive.id} (owner ${hive.user_id}): Will assign guild_id = ${assignedGuildId} (user has ${guildIds.length} guild(s))`);
    
    if (apply) {
      try {
        await knex('hives')
          .where({ id: hive.id })
          .update({ guild_id: assignedGuildId, updated_at: knex.fn.now() });
        updated++;
      } catch (e) {
        console.error(`❌ Failed to update hive ${hive.id}:`, e && e.stack || e);
      }
    }
  }
  
  console.log('\nMigration summary:');
  console.log(`  Total hives: ${hives.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  
  if (!apply) {
    console.log('\nℹ️  Run with --apply to actually update the database');
  }
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');

migrate(apply).then(() => process.exit(0)).catch(err => { console.error(err && err.stack || err); process.exit(2); });
