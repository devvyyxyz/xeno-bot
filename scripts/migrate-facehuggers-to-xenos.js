/*
Migration: convert legacy `items.facehugger` inventory entries into xenomorph rows.

Usage:
  node scripts/migrate-facehuggers-to-xenos.js          # dry run
  node scripts/migrate-facehuggers-to-xenos.js --apply  # apply changes
*/

const db = require('../src/db');

function parseData(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return null;
  }
}

function findLegacyFacehuggers(data) {
  const out = [];
  const guilds = data && data.guilds && typeof data.guilds === 'object' ? data.guilds : {};
  for (const [guildId, guildData] of Object.entries(guilds)) {
    const qty = Number(guildData && guildData.items ? guildData.items.facehugger || 0 : 0);
    if (qty > 0) out.push({ guildId, qty });
  }
  return out;
}

async function migrate(apply = false) {
  console.log('Running facehugger -> xenomorph migration', apply ? '(APPLY)' : '(DRY RUN)');
  await db.migrate();
  const knex = db.knex;

  const rows = await knex('users').select('id', 'discord_id', 'data');
  console.log(`Users scanned: ${rows.length}`);

  const candidates = [];
  let totalFacehuggers = 0;

  for (const row of rows) {
    const data = parseData(row.data);
    if (!data) continue;
    const legacy = findLegacyFacehuggers(data);
    if (!legacy.length) continue;
    const subtotal = legacy.reduce((sum, g) => sum + Number(g.qty || 0), 0);
    totalFacehuggers += subtotal;
    candidates.push({ id: row.id, discordId: String(row.discord_id), data, legacy, subtotal });
  }

  console.log(`Users with legacy facehuggers: ${candidates.length}`);
  console.log(`Total legacy facehuggers found: ${totalFacehuggers}`);

  if (!apply) {
    for (const c of candidates.slice(0, 20)) {
      const parts = c.legacy.map(l => `${l.guildId}:${l.qty}`).join(', ');
      console.log(`[DRY] user=${c.discordId} total=${c.subtotal} guilds=[${parts}]`);
    }
    if (candidates.length > 20) console.log('... (truncated)');
    return;
  }

  let usersChanged = 0;
  let xenosCreated = 0;

  for (const c of candidates) {
    try {
      await knex.transaction(async trx => {
        for (const g of c.legacy) {
          for (let i = 0; i < g.qty; i++) {
            await trx('xenomorphs').insert({
              owner_id: c.discordId,
              hive_id: null,
              pathway: 'standard',
              role: 'facehugger',
              stage: 'facehugger',
              level: 1,
              stats: null,
              data: JSON.stringify({ source: 'legacy_item_facehugger_migration', guildId: g.guildId })
            });
            xenosCreated++;
          }
          if (c.data.guilds && c.data.guilds[g.guildId] && c.data.guilds[g.guildId].items) {
            delete c.data.guilds[g.guildId].items.facehugger;
          }
        }

        await trx('users')
          .where({ id: c.id })
          .update({ data: JSON.stringify(c.data), updated_at: trx.fn.now() });
      });

      usersChanged++;
    } catch (e) {
      console.error(`Failed migrating user ${c.discordId}:`, e && (e.stack || e));
    }
  }

  console.log('Migration complete.');
  console.log(`Users changed: ${usersChanged}`);
  console.log(`Xenomorph rows created: ${xenosCreated}`);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');

migrate(apply)
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err && (err.stack || err));
    process.exit(2);
  });
