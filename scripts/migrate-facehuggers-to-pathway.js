#!/usr/bin/env node
// Migrate xenomorph rows with generic 'facehugger' role/stage to pathway-specific variants
// Usage: node scripts/migrate-facehuggers-to-pathway.js [--apply] [--what role|stage|both]

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    what: (args.find(a => a.startsWith('--what=')) || '--what=both').split('=')[1] || 'both'
  };
}

(async function main() {
  const args = parseArgs();
  const evol = require('../config/evolutions.json');
  const db = require('../src/db');
  try {
    await db.migrate();
    const knex = db.knex;

    const rows = await knex('xenomorphs').select('id','owner_id','pathway','role','stage');
    const toUpdate = [];

    for (const r of rows) {
      const pathway = (r.pathway || 'standard') || 'standard';
      if (!pathway || pathway === 'standard') continue; // standard uses generic facehugger
      const candidate = `${pathway}_facehugger`;
      // check whether candidate exists in config (roles or pathway stages)
      const roleExists = (evol.roles && Object.prototype.hasOwnProperty.call(evol.roles, candidate));
      const stageExists = (evol.pathways && evol.pathways[pathway] && Array.isArray(evol.pathways[pathway].stages) && evol.pathways[pathway].stages.includes(candidate));
      if (!roleExists && !stageExists) continue; // nothing to map to

      const plan = { id: r.id, owner_id: r.owner_id, pathway, role: r.role, stage: r.stage, target: candidate, updateRole: false, updateStage: false };
      if ((args.what === 'role' || args.what === 'both') && r.role === 'facehugger') plan.updateRole = true;
      if ((args.what === 'stage' || args.what === 'both') && r.stage === 'facehugger') plan.updateStage = true;
      if (plan.updateRole || plan.updateStage) toUpdate.push(plan);
    }

    if (toUpdate.length === 0) {
      console.log('No legacy facehugger rows found for non-standard pathways.');
      process.exit(0);
    }

    console.log(`Found ${toUpdate.length} xenomorph(s) to update (dry-run):`);
    for (const p of toUpdate) {
      console.log(`- id=${p.id}, owner=${p.owner_id}, pathway=${p.pathway}, role=${p.role}, stage=${p.stage} -> target=${p.target}${p.updateRole? ' (role)':''}${p.updateStage? ' (stage)':''}`);
    }

    if (!args.apply) {
      console.log('\nDry run complete. Re-run with --apply to perform updates.');
      process.exit(0);
    }

    console.log('\nApplying updates...');
    let applied = 0;
    for (const p of toUpdate) {
      const updates = {};
      if (p.updateRole) updates.role = p.target;
      if (p.updateStage) updates.stage = p.target;
      if (Object.keys(updates).length === 0) continue;
      updates.updated_at = knex.fn.now();
      const affected = await knex('xenomorphs').where({ id: p.id }).update(updates);
      if (affected && affected > 0) {
        applied++;
        console.log(`Updated id=${p.id}: ${Object.keys(updates).join(', ')}`);
      }
    }

    console.log(`Done. Applied updates: ${applied}`);
    process.exit(0);
  } catch (e) {
    console.error('Migration failed', e && (e.stack || e));
    process.exit(2);
  }
})();
