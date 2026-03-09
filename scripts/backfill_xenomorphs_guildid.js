#!/usr/bin/env node
const dbModule = require('../src/db');
const { parseJSON } = require('../src/utils/jsonParse');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const db = dbModule;
  await db.migrate();
  const knex = db.knex;

  const batchSize = 200;
  let offset = 0;
  let totalUpdated = 0;
  const updatedExamples = [];

  const whereRaw = "(guild_id IS NULL OR guild_id = '')";
  const totalRowsObj = await knex('xenomorphs').whereRaw(whereRaw).count('* as cnt').first();
  const totalRows = Number(totalRowsObj && totalRowsObj.cnt) || 0;
  console.log(`Found ${totalRows} xenomorph rows missing guild_id`);
  if (totalRows === 0) return process.exit(0);

  while (true) {
    const rows = await knex('xenomorphs').whereRaw(whereRaw).select('id', 'hive_id', 'owner_id', 'data').limit(batchSize).offset(offset);
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      let updated = false;
      try {
        // 1) hive join
        if (r.hive_id) {
          const hive = await knex('hives').where({ id: r.hive_id }).first();
          if (hive && hive.guild_id) {
            if (!dryRun) await knex('xenomorphs').where({ id: r.id }).update({ guild_id: hive.guild_id, updated_at: knex.fn.now() });
            totalUpdated++;
            updated = true;
            updatedExamples.push({ id: r.id, method: 'hive_join', guild_id: hive.guild_id });
            continue;
          }
        }

        // 2) data JSON
        let parsed = null;
        try { parsed = parseJSON(r.data, null); } catch (_) { parsed = null; }
        if (parsed && parsed.guild_id) {
          if (!dryRun) await knex('xenomorphs').where({ id: r.id }).update({ guild_id: String(parsed.guild_id), updated_at: knex.fn.now() });
          totalUpdated++;
          updated = true;
          updatedExamples.push({ id: r.id, method: 'data_json', guild_id: parsed.guild_id });
          continue;
        }

        // 3) owner's hive (find any hive for this owner that has guild_id)
        if (r.owner_id) {
          // check hives by user_id or owner_discord_id (some schemas use different column names)
          let hiveRow = null;
          try {
            hiveRow = await knex('hives').where({ user_id: String(r.owner_id) }).whereNotNull('guild_id').first();
          } catch (e) {
            hiveRow = null;
          }
          if (!hiveRow) {
            try {
              hiveRow = await knex('hives').where({ owner_discord_id: String(r.owner_id) }).whereNotNull('guild_id').first();
            } catch (e) {
              hiveRow = null;
            }
          }
          if (hiveRow && hiveRow.guild_id) {
            if (!dryRun) await knex('xenomorphs').where({ id: r.id }).update({ guild_id: hiveRow.guild_id, updated_at: knex.fn.now() });
            totalUpdated++;
            updated = true;
            updatedExamples.push({ id: r.id, method: 'owner_hive', guild_id: hiveRow.guild_id });
            continue;
          }
        }

        // 4) user's saved guilds in users.data — if exactly one guild present, assume xeno belongs there
        try {
          const userRow = await knex('users').where({ discord_id: String(r.owner_id) }).first();
          if (userRow && userRow.data) {
            let parsedUser = null;
            try { parsedUser = JSON.parse(userRow.data); } catch (_) { parsedUser = null; }
            if (parsedUser && parsedUser.guilds && typeof parsedUser.guilds === 'object') {
              const guildKeys = Object.keys(parsedUser.guilds).filter(Boolean);
              if (guildKeys.length === 1) {
                const g = guildKeys[0];
                if (!dryRun) await knex('xenomorphs').where({ id: r.id }).update({ guild_id: String(g), updated_at: knex.fn.now() });
                totalUpdated++;
                updated = true;
                updatedExamples.push({ id: r.id, method: 'user_guild_single', guild_id: g });
                continue;
              }
            }
          }
        } catch (e) {
          // ignore and continue
        }

        // 4) no heuristic matched: leave for manual inspection
      } catch (e) {
        console.error(`Failed processing xeno ${r.id}: ${e && (e.message || e)}`);
      }
    }
    offset += rows.length;
    process.stdout.write(`Processed ${Math.min(offset, totalRows)}/${totalRows} rows, updated ${totalUpdated}\r`);
  }

  console.log('\nDone.');
  console.log(`Total updated (or would be updated in dry-run): ${totalUpdated}`);
  if (updatedExamples.length) {
    console.log('Examples:', JSON.stringify(updatedExamples.slice(0, 10), null, 2));
  }
  process.exit(0);
}

main().catch(e => { console.error(e && (e.stack || e)); process.exit(1); });
