#!/usr/bin/env node
// Find xenomorph rows containing a given string in pathway/role/stage or JSON data
// Usage: node scripts/find-xeno-string.js space_jockey

const term = process.argv[2];
if (!term) {
  console.error('Usage: node scripts/find-xeno-string.js <term>');
  process.exit(1);
}

(async function main() {
  try {
    const db = require('../src/db');
    await db.migrate();
    const knex = db.knex;
    const rows = await knex('xenomorphs').select('*').orderBy('id', 'asc');
    const matches = [];
    for (const r of rows) {
      const id = r.id;
      const pathway = r.pathway || '';
      const role = r.role || '';
      const stage = r.stage || '';
      const stats = r.stats || null;
      const data = r.data || null;
      const hay = [String(pathway), String(role), String(stage)];
      let found = false;
      for (const h of hay) {
        if (h && h.includes(term)) { found = true; break; }
      }
      try {
        const parsedStats = stats ? JSON.parse(stats) : null;
        const parsedData = data ? JSON.parse(data) : null;
        const jsonStr = JSON.stringify(parsedStats) + ' ' + JSON.stringify(parsedData);
        if (jsonStr && jsonStr.includes(term)) found = true;
      } catch (_) {}
      if (found) matches.push(r);
    }
    if (matches.length === 0) {
      console.log(`No xenomorphs found containing term: ${term}`);
      process.exit(0);
    }
    console.log(`Found ${matches.length} matching xenomorph(s):`);
    for (const m of matches) {
      console.log(`- ID: ${m.id}, owner_id: ${m.owner_id}, pathway: ${m.pathway}, role: ${m.role}, stage: ${m.stage}`);
    }
    process.exit(0);
  } catch (e) {
    console.error('Search failed', e && (e.stack || e));
    process.exit(2);
  }
})();
