#!/usr/bin/env node
// Analyze xenomorph rows and evolutions config to suggest conditional mappings
// Usage: node scripts/generate-xeno-mapping.js

const fs = require('fs');
const path = require('path');

(async function main() {
  try {
    const evol = require('../config/evolutions.json');
    const db = require('../src/db');
    await db.migrate();
    const knex = db.knex;

    const rows = await knex('xenomorphs').select('id','pathway','role','stage');
    const suggestions = []; // entries: { id, col, old, new }

    for (const r of rows) {
      const pathway = r.pathway || 'standard';
      const role = r.role || '';
      const stage = r.stage || '';

      // If role is 'facehugger' and pathway has a specific facehugger stage
      if (role === 'facehugger' && pathway && pathway !== 'standard') {
        const candidate = `${pathway}_facehugger`;
        // check if candidate exists in evol.roles or evol.pathways
        const roleExists = (evol.roles && evol.roles[candidate]) || (evol.pathways && evol.pathways[pathway] && evol.pathways[pathway].stages && evol.pathways[pathway].stages.includes(candidate));
        if (roleExists) suggestions.push({ col: 'role', id: r.id, old: role, new: candidate, pathway });
      }

      if (stage === 'facehugger' && pathway && pathway !== 'standard') {
        const candidate = `${pathway}_facehugger`;
        const stageExists = (evol.roles && evol.roles[candidate]) || (evol.pathways && evol.pathways[pathway] && evol.pathways[pathway].stages && evol.pathways[pathway].stages.includes(candidate));
        if (stageExists) suggestions.push({ col: 'stage', id: r.id, old: stage, new: candidate, pathway });
      }
    }

    if (suggestions.length === 0) {
      console.log('No conditional mappings suggested.');
      process.exit(0);
    }

    // Aggregate suggestions into mapping per old->new per column and pathway
    const mapping = {};
    for (const s of suggestions) {
      const key = `${s.col}:${s.old}:${s.pathway}`; // conditional key
      mapping[key] = mapping[key] || { col: s.col, old: s.old, new: s.new, pathway: s.pathway, ids: [] };
      mapping[key].ids.push(s.id);
    }

    const out = Object.values(mapping);
    console.log('Suggested conditional mappings:');
    for (const m of out) {
      console.log(`- Column: ${m.col}, pathway: ${m.pathway}, ${m.old} -> ${m.new} (ids: ${m.ids.length})`);
    }

    const outFile = path.resolve('tmp','suggested-xeno-mapping.json');
    try { fs.mkdirSync(path.dirname(outFile), { recursive: true }); } catch (_) {}
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
    console.log('\nWrote suggestions to', outFile);
    process.exit(0);
  } catch (e) {
    console.error('Failed generating suggestions', e && (e.stack || e));
    process.exit(2);
  }
})();
