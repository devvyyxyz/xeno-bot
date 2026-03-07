#!/usr/bin/env node
// List distinct values for xenomorph fields: pathway, role, stage
// Usage: node scripts/list-xeno-types.js

const path = require('path');
(async function main() {
  try {
    const db = require('../src/db');
    await db.migrate();
    const knex = db.knex;
    const fields = ['pathway', 'role', 'stage'];
    for (const f of fields) {
      const rows = await knex('xenomorphs').distinct(f).orderBy(f);
      const values = rows.map(r => r[f]).filter(Boolean);
      console.log(`${f.toUpperCase()} (${values.length} distinct):`);
      for (const v of values) {
        const cnt = await knex('xenomorphs').where({ [f]: v }).count('* as cnt').first();
        console.log(`  ${v} — ${cnt.cnt}`);
      }
      console.log('');
    }
    process.exit(0);
  } catch (e) {
    console.error('Failed listing xeno types', e && (e.stack || e));
    process.exit(2);
  }
})();
