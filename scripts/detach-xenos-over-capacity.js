#!/usr/bin/env node
/*
  Script: detach-xenos-over-capacity.js
  - Finds hives where the number of attached xenomorphs exceeds the hive.capacity
  - Detaches the newest excess xenomorphs by setting their `hive_id` to NULL
  - Non-destructive: xenomorph rows remain owned by the user
  Usage: `node scripts/detach-xenos-over-capacity.js`
*/


const db = require('../src/db');

(async function main() {
  try {
    await db.migrate();
    const knex = db.knex;
    if (!knex) throw new Error('Database not initialized');
    const hives = await knex('hives').select('id', 'capacity');
    let totalDetached = 0;
    for (const hive of hives) {
      const cap = Number(hive.capacity) || 0;
      if (cap <= 0) continue;

      // Order by id desc so we detach the most-recently-created xenos first
      const attached = await knex('xenomorphs').where({ hive_id: hive.id }).select('id').orderBy('id', 'desc');
      const count = attached.length;
      if (count <= cap) continue;

      const excess = count - cap;
      const toDetach = attached.slice(0, excess).map(r => r.id);
      if (toDetach.length === 0) continue;

      console.log(`Hive ${hive.id} over capacity: ${count}/${cap} — detaching ${toDetach.length} xenomorph(s)`);
      await knex('xenomorphs').whereIn('id', toDetach).update({ hive_id: null, updated_at: knex.fn.now() });
      totalDetached += toDetach.length;
    }

    console.log(`Done. Detached ${totalDetached} xenomorph(s).`);
    process.exit(0);
  } catch (err) {
    console.error('Error detaching xenomorphs over capacity:', err && (err.stack || err));
    process.exit(2);
  }
})();
