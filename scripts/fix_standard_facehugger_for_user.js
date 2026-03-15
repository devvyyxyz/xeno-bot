#!/usr/bin/env node
// Fix literal `standard_facehugger` values for a specific user and guild
// Usage:
//   node scripts/fix_standard_facehugger_for_user.js --owner <owner_id> --guild <guild_id>
//   node scripts/fix_standard_facehugger_for_user.js --owner <owner_id> --guild <guild_id> --apply

process.env.DB_POOL_MAX = process.env.DB_POOL_MAX || '6';
const db = require('../src/db');

function parseArgs() {
  const args = process.argv.slice(2);
  const owner = (() => {
    const i = args.indexOf('--owner');
    return i >= 0 && args[i+1] ? String(args[i+1]) : null;
  })();
  const guild = (() => {
    const i = args.indexOf('--guild');
    return i >= 0 && args[i+1] ? String(args[i+1]) : null;
  })();
  return { owner, guild, apply: args.includes('--apply') };
}

function safeParseData(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return null; }
}

(async function main() {
  const args = parseArgs();
  if (!args.owner || !args.guild) {
    console.error('Missing --owner or --guild.');
    process.exitCode = 2;
    return;
  }

  let knex;
  try {
    await db.migrate();
    knex = db.knex;

    const rows = await knex('xenomorphs as x')
      .leftJoin('hives as h', 'x.hive_id', 'h.id')
      .select('x.id','x.owner_id','x.hive_id','h.guild_id','x.pathway','x.role','x.stage','x.data')
      .where(function() {
        this.where('x.role', 'standard_facehugger').orWhere('x.stage', 'standard_facehugger');
      })
      .andWhere('x.owner_id', String(args.owner))
      .andWhere(function() {
        this.where('h.guild_id', String(args.guild)).orWhereNull('h.guild_id');
      })
      .orderBy('x.id', 'asc');

    if (!rows.length) {
      console.log('No matching xenomorphs found for that owner/guild with "standard_facehugger".');
      return;
    }

    console.log(`Found ${rows.length} candidate row(s):`);
    const plans = rows.map(r => {
      const p = { id: r.id, owner_id: r.owner_id, hive_id: r.hive_id, guild_id: r.guild_id, pathway: r.pathway, changes: {}, data_note: null };
      if (r.role === 'standard_facehugger') p.changes.role = 'facehugger';
      if (r.stage === 'standard_facehugger') p.changes.stage = 'facehugger';
      if (!r.pathway) p.changes.pathway = 'standard';

      const parsed = safeParseData(r.data);
      if (parsed === null) {
        p.data_note = 'data JSON parse failed; will replace with migration marker if applying';
      } else {
        parsed._migrations = parsed._migrations || {};
        parsed._migrations.standard_facehugger_fix = true;
        p.data_note = 'will tag data._migrations.standard_facehugger_fix = true';
        p.new_data = JSON.stringify(parsed);
      }
      return p;
    });

    for (const p of plans) {
      console.log(`- id=${p.id}, owner=${p.owner_id}, hive_id=${p.hive_id || 'null'}, guild_id=${p.guild_id || 'null'}`);
      for (const [k,v] of Object.entries(p.changes)) console.log(`    ${k}: -> ${v}`);
      console.log(`    note: ${p.data_note}`);
    }

    if (!args.apply) {
      console.log('\nDry run complete. Re-run with --apply to perform updates for these rows.');
      return;
    }

    console.log('\nApplying updates...');
    let applied = 0;
    for (const p of plans) {
      try {
        await knex.transaction(async trx => {
          const updates = Object.assign({}, p.changes);
          if (p.new_data) updates.data = p.new_data;
          else if (p.data_note && p.data_note.includes('replace with migration marker')) updates.data = JSON.stringify({ _migrations: { standard_facehugger_fix: true } });
          if (Object.keys(updates).length === 0) return;
          updates.updated_at = knex.fn.now();
          const affected = await trx('xenomorphs').where({ id: p.id }).update(updates);
          if (affected && affected > 0) applied++;
        });
      } catch (e) {
        console.error(`Failed updating id=${p.id}:`, e && (e.stack || e));
      }
    }

    console.log(`Done. Applied updates: ${applied}`);
  } catch (e) {
    console.error('Script failed:', e && (e.stack || e));
    process.exitCode = 2;
  } finally {
    try { if (knex && typeof knex.destroy === 'function') await knex.destroy(); } catch (e) { /* ignore */ }
  }
})();
