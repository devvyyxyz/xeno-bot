#!/usr/bin/env node
/**
 * Migrate hosts with NULL/empty guild_id by inferring guild_id from other tables.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/migrate_attach_hosts_by_owner.js
 *
 * Options (environment variables):
 *   BATCH_SIZE  Number of owners to process per batch  (default: 50)
 *   DRY_RUN     Set to "true" to log changes without writing (default: false)
 */
'use strict';

const path = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderProgress(done, total) {
  const WIDTH = 40;
  const pct   = total === 0 ? 1 : Math.min(1, done / total);
  const filled = Math.round(pct * WIDTH);
  const bar    = `[${'='.repeat(filled)}${' '.repeat(WIDTH - filled)}] ${String(Math.round(pct * 100)).padStart(3)}% (${done}/${total})`;
  console.log(bar);
}

/**
 * Return the most frequently occurring value in an array, or null if empty.
 */
function mostFrequent(values) {
  if (!values.length) return null;
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

/**
 * Safely parse a JSON column value that may already be an object.
 */
function parseJsonColumn(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db    = require(path.join(__dirname, '..', 'src', 'db'));

  const BATCH_SIZE = process.env.BATCH_SIZE ? Number(process.env.BATCH_SIZE) : 50;
  const DRY_RUN    = process.env.DRY_RUN === 'true';

  await db.migrate();

  const knex  = db.knex;

  if (DRY_RUN) console.log('[DRY RUN] No writes will be made.');
  console.log(`Starting migration  batch_size=${BATCH_SIZE}`);

  // ── 1. Collect all owners that need work ──────────────────────────────────

  const allOwnerRows = await knex('hosts')
    .where(function () { this.whereNull('guild_id').orWhere('guild_id', ''); })
    .distinct('owner_id')
    .select('owner_id');

    const allOwners  = allOwnerRows.map(r => r.owner_id);
    const totalOwners = allOwners.length;

    // Compute total hosts to update so we can show per-host progress.
    const totalHostsRow = await knex('hosts')
      .where(function () { this.whereNull('guild_id').orWhere('guild_id', ''); })
      .count('id as n');
    const totalHosts = Number(totalHostsRow[0]?.n ?? 0);

    if (!totalOwners || !totalHosts) {
      console.log('Nothing to migrate — all hosts already have a guild_id.');
      process.exit(0);
    }

    console.log(`Found ${totalOwners} owner(s) with unattached hosts (${totalHosts} host(s) total).
  `);
    renderProgress(0, totalHosts);
  // ── 2. Process in batches ─────────────────────────────────────────────────

  let totalUpdated  = 0;
  let totalSkipped  = 0;
  let processedOwners = 0;
    let processedHosts = 0;

  for (let offset = 0; offset < totalOwners; offset += BATCH_SIZE) {
    const batch = allOwners.slice(offset, offset + BATCH_SIZE);

    // Fetch guild candidates for every owner in this batch — 2 queries, not 2N.
    const [hiveRows, hatchRows] = await Promise.all([
      knex('hives')
        .whereIn('user_id', batch.map(String))
        .whereNotNull('guild_id')
        .andWhere('guild_id', '!=', '')
        .select('user_id as owner_id', 'guild_id'),

      knex('hatches')
        .whereIn('discord_id', batch.map(String))
        .whereNotNull('guild_id')
        .andWhere('guild_id', '!=', '')
        .select('discord_id as owner_id', 'guild_id'),
    ]);

    // Build a map: owner_id → [guild_id, ...]
    const candidateMap = {};
    for (const r of [...hiveRows, ...hatchRows]) {
      const key = String(r.owner_id);
      (candidateMap[key] = candidateMap[key] || []).push(String(r.guild_id));
    }

    // Process each owner in this batch.
    for (const owner of batch) {
      const candidates = candidateMap[String(owner)] || [];
      const selected   = mostFrequent(candidates);

      processedOwners++;

      if (!selected) {
        totalSkipped++;
        console.log(`  [SKIP]  owner=${owner}  reason=no_candidate_guild_id`);
          renderProgress(processedHosts, totalHosts);
        continue;
      }

      console.log(`  owner=${owner}  candidates=${JSON.stringify(candidates)}  selected=${selected}`);

      try {
        const client = String(((knex && knex.client && knex.client.config && knex.client.config.client) || '')).toLowerCase();
        const isMysql = client.includes('mysql');
        const isPg = client.includes('pg') || client.includes('postgres');

        if (!DRY_RUN) {
          await knex.transaction(async (trx) => {
            // Count rows first
            const cntRow = await trx('hosts')
              .where({ owner_id: String(owner) })
              .andWhere(function () { this.whereNull('guild_id').orWhere('guild_id', ''); })
              .count('id as n');
            const n = Number(cntRow[0]?.n ?? 0);

            if (n > 0) {
              if (isMysql) {
                await trx('hosts')
                  .where({ owner_id: String(owner) })
                  .andWhere(function () { this.whereNull('guild_id').orWhere('guild_id', ''); })
                  .update({ guild_id: selected, data: trx.raw("JSON_SET(COALESCE(data, '{}'), '$.guild_id', ?)", [selected]) });
              } else if (isPg) {
                await trx('hosts')
                  .where({ owner_id: String(owner) })
                  .andWhere(function () { this.whereNull('guild_id').orWhere('guild_id', ''); })
                  .update({ guild_id: selected, data: trx.raw("jsonb_set(COALESCE(data::jsonb, '{}'::jsonb), '{guild_id}', to_jsonb(?::text))", [selected]) });
              } else {
                // Fallback: update per-row (slower)
                const rows = await trx('hosts')
                  .where({ owner_id: String(owner) })
                  .andWhere(function () { this.whereNull('guild_id').orWhere('guild_id', ''); })
                  .select('id', 'data');
                for (const row of rows) {
                  const data = parseJsonColumn(row.data);
                  data.guild_id = selected;
                  await trx('hosts').where({ id: row.id }).update({ guild_id: selected, data: JSON.stringify(data) });
                }
              }

              // Account for processed hosts and show progress in reasonable steps.
              totalUpdated += n;
              if (n <= 200) {
                for (let i = 0; i < n; i++) { processedHosts++; renderProgress(processedHosts, totalHosts); }
              } else {
                const step = Math.max(1, Math.floor(n / 100));
                let advanced = 0;
                while (advanced < n) {
                  const inc = Math.min(step, n - advanced);
                  processedHosts += inc;
                  advanced += inc;
                  renderProgress(processedHosts, totalHosts);
                }
              }

              console.log(`    → updated ${n} host(s)  guild_id=${selected}`);
            } else {
              console.log(`    → no hosts to update for owner ${owner}`);
            }
          });
        } else {
          // Dry-run: count rows that would be affected and step progress similarly.
          const cntRow = await knex('hosts')
            .where({ owner_id: String(owner) })
            .andWhere(function () { this.whereNull('guild_id').orWhere('guild_id', ''); })
            .count('id as n');
          const n = Number(cntRow[0]?.n ?? 0);
          totalUpdated += n;
          console.log(`    [DRY RUN] would update ${n} host(s)  guild_id=${selected}`);

          if (n <= 200) {
            for (let i = 0; i < n; i++) { processedHosts++; renderProgress(processedHosts, totalHosts); }
          } else {
            const step = Math.max(1, Math.floor(n / 100));
            let advanced = 0;
            while (advanced < n) {
              const inc = Math.min(step, n - advanced);
              processedHosts += inc;
              advanced += inc;
              renderProgress(processedHosts, totalHosts);
            }
          }
        }
      } catch (err) {
        totalSkipped++;
        console.error(`  [ERROR] owner=${owner}:`, err?.message ?? err);
      }

      renderProgress(processedHosts, totalHosts);
    }

    // Brief pause between batches to reduce DB pressure.
    if (offset + BATCH_SIZE < totalOwners) {
          renderProgress(processedHosts, totalHosts);
    }
  }

  // ── 3. Summary ────────────────────────────────────────────────────────────

  console.log(`\nMigration ${DRY_RUN ? '(DRY RUN) ' : ''}complete.`);
  console.log(`  Hosts updated : ${totalUpdated}`);
  console.log(`  Owners skipped: ${totalSkipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err?.stack ?? err);
  process.exit(2);
});