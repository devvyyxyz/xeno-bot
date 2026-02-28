/*
Migration script: move per-guild credits into global data.currency.credits
Usage:
  node scripts/migrate-credits-global.js [--apply]

Without --apply the script runs in dry-run mode and prints proposed changes.
With --apply it updates users in the DB.
*/

const db = require('../src/db');
const knex = db.knex;

async function migrate(apply = false) {
  console.log('Starting credits migration. apply=', apply);
  const rows = await knex('users').select('id', 'discord_id', 'data');
  console.log(`Found ${rows.length} users`);
  let changed = 0;
  for (const row of rows) {
    let data;
    try {
      data = row.data ? JSON.parse(row.data) : {};
    } catch (e) {
      console.warn(`Skipping user ${row.discord_id} due to JSON parse error`);
      continue;
    }
    data.guilds = data.guilds || {};
    data.currency = data.currency || {};
    let totalMoved = 0;
    for (const [guildId, gobj] of Object.entries(data.guilds)) {
      if (gobj && gobj.currency && typeof gobj.currency === 'object' && Object.prototype.hasOwnProperty.call(gobj.currency, 'credits')) {
        const val = Number(gobj.currency.credits || 0);
        if (val !== 0) {
          totalMoved += val;
        }
        // remove the credits key from guild currency
        delete gobj.currency.credits;
        // if currency object is empty, remove it to keep data tidy
        if (Object.keys(gobj.currency).length === 0) delete gobj.currency;
      }
    }
    if (totalMoved > 0) {
      const prev = Number(data.currency.credits || 0);
      const next = prev + totalMoved;
      console.log(`User ${row.discord_id} will move ${totalMoved} credits into global (was ${prev} -> ${next})`);
      if (apply) {
        data.currency = data.currency || {};
        data.currency.credits = next;
        // write back
        try {
          await knex('users').where({ id: row.id }).update({ data: JSON.stringify(data), updated_at: knex.fn.now() });
          changed++;
        } catch (e) {
          console.error(`Failed to update user ${row.discord_id}:`, e && e.stack || e);
        }
      }
    }
  }
  console.log(`Migration complete. users changed: ${changed}`);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');

migrate(apply).then(() => process.exit(0)).catch(err => { console.error(err && err.stack || err); process.exit(2); });
