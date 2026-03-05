/*
Migration: clear stale xenomorph -> hive assignments when ownership doesn't match.

This fixes historical data where a xenomorph kept its hive_id after being gifted.
A xenomorph should only be assigned to a hive owned by the same user.

Usage:
  node scripts/migrate-clear-invalid-xeno-hive-links.js          # dry run
  node scripts/migrate-clear-invalid-xeno-hive-links.js --apply  # apply changes
*/

const db = require('../src/db');

async function migrate(apply = false) {
  console.log('Running stale xeno hive-link cleanup', apply ? '(APPLY)' : '(DRY RUN)');
  await db.migrate();
  const knex = db.knex;

  const hasOwnerDiscordId = await knex.schema.hasColumn('hives', 'owner_discord_id').catch(() => false);
  const hasUserId = await knex.schema.hasColumn('hives', 'user_id').catch(() => false);
  const hiveOwnerColumn = hasOwnerDiscordId ? 'owner_discord_id' : (hasUserId ? 'user_id' : null);

  if (!hiveOwnerColumn) {
    console.log('No supported hive owner column found (`owner_discord_id` or `user_id`). Aborting.');
    return;
  }

  const rows = await knex('xenomorphs as x')
    .leftJoin('hives as h', 'x.hive_id', 'h.id')
    .whereNotNull('x.hive_id')
    .select('x.id as xeno_id', 'x.owner_id as xeno_owner_id', 'x.hive_id', `h.${hiveOwnerColumn} as hive_owner_id`, 'h.id as hive_exists_id');

  const invalid = rows.filter(r => {
    if (!r.hive_exists_id) return true;
    return String(r.xeno_owner_id) !== String(r.hive_owner_id);
  });

  console.log(`Checked assigned xenos: ${rows.length}`);
  console.log(`Invalid links found: ${invalid.length}`);

  if (invalid.length > 0) {
    console.log('Sample invalid links:');
    invalid.slice(0, 10).forEach(r => {
      const hiveOwner = r.hive_owner_id == null ? 'missing' : r.hive_owner_id;
      console.log(`  - xeno ${r.xeno_id}: owner=${r.xeno_owner_id}, hive_id=${r.hive_id}, hive_owner=${hiveOwner}`);
    });
    if (invalid.length > 10) console.log(`  ... and ${invalid.length - 10} more`);
  }

  if (!apply) {
    console.log('\nDRY RUN complete. Re-run with --apply to clear hive_id on invalid links.');
    return;
  }

  if (!invalid.length) {
    console.log('No changes needed.');
    return;
  }

  const ids = invalid.map(r => r.xeno_id);
  const updated = await knex('xenomorphs').whereIn('id', ids).update({ hive_id: null });
  console.log(`Updated xenos: ${updated}`);
}

const apply = process.argv.includes('--apply');

migrate(apply)
  .then(() => {
    console.log('Cleanup finished.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
