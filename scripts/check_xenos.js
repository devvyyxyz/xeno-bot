const path = require('path');
const Knex = require('knex');
const knexfile = require('../knexfile');

async function main() {
  const env = process.env.NODE_ENV || 'production';
  const cfg = knexfile[env] || knexfile.production;
  const knex = Knex(cfg);
  try {
    const ownerId = process.argv[2];
    if (!ownerId) {
      console.error('Usage: node scripts/check_xenos.js <ownerId>');
      process.exit(2);
    }
    const rows = await knex('xenomorphs').where({ owner_id: String(ownerId) }).orderBy('id', 'desc').limit(10);
    console.log(JSON.stringify(rows, null, 2));
    await knex.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Query failed:', err && (err.message || err));
    try { await knex.destroy(); } catch (_) {}
    process.exit(1);
  }
}

main();
