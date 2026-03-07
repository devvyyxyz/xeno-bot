#!/usr/bin/env node
// Upgrade xenomorph type strings according to a mapping JSON
// Usage: node scripts/upgrade-xeno-types.js --map mappings.json [--apply]
// mappings.json example: { "space_jockey": "space_jockey_facehugger" }

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { mapFile: null, apply: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--map' && args[i+1]) { out.mapFile = args[i+1]; i++; }
    else if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

(async function main() {
  const args = parseArgs();
  if (args.help || !args.mapFile) {
    console.log('Usage: node scripts/upgrade-xeno-types.js --map mappings.json [--apply]');
    process.exit(args.help ? 0 : 1);
  }
  const mapPath = path.resolve(args.mapFile);
  if (!fs.existsSync(mapPath)) {
    console.error('Mapping file not found:', mapPath);
    process.exit(2);
  }
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  if (!mapping || typeof mapping !== 'object') {
    console.error('Invalid mapping JSON');
    process.exit(2);
  }
  try {
    const db = require('../src/db');
    await db.migrate();
    const knex = db.knex;
    const columns = ['pathway','role','stage'];
    let totalPlanned = 0;
    for (const [oldVal, newVal] of Object.entries(mapping)) {
      for (const col of columns) {
        const countRow = await knex('xenomorphs').where({ [col]: oldVal }).count('* as cnt').first();
        const cnt = Number(countRow && countRow.cnt) || 0;
        if (cnt > 0) {
          console.log(`Found ${cnt} rows with ${col}='${oldVal}' → will update to '${newVal}'`);
          totalPlanned += cnt;
        }
      }
    }
    if (totalPlanned === 0) {
      console.log('No rows to update according to provided mapping. Exiting.');
      process.exit(0);
    }
    if (!args.apply) {
      console.log('\nDry run complete. Re-run with --apply to perform updates.');
      process.exit(0);
    }

    console.log('\nApplying updates...');
    for (const [oldVal, newVal] of Object.entries(mapping)) {
      for (const col of columns) {
        const affected = await knex('xenomorphs').where({ [col]: oldVal }).update({ [col]: newVal, updated_at: knex.fn.now() });
        if (affected && affected > 0) console.log(`Updated ${affected} rows: ${col} ${oldVal} → ${newVal}`);
      }
    }
    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error('Failed applying mapping', e && (e.stack || e));
    process.exit(3);
  }
})();
