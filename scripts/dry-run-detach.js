#!/usr/bin/env node
const db = require('../src/db');

(async function main() {
  try {
    await db.migrate();
    const rows = await db.knex('hives as h')
      .join('xenomorphs as x', 'x.hive_id', 'h.id')
      .select('h.id as hive_id', 'h.capacity')
      .count('x.id as attached')
      .groupBy('h.id', 'h.capacity')
      .havingRaw('count(x.id) > h.capacity')
      .orderBy('h.id');

    if (!rows || rows.length === 0) {
      console.log('No hives over capacity.');
      process.exit(0);
    }

    console.log('Hives over capacity:');
    for (const r of rows) {
      console.log(`- hive_id=${r.hive_id} attached=${r.attached} capacity=${r.capacity}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Dry-run failed:', err && (err.stack || err));
    process.exit(2);
  }
})();
