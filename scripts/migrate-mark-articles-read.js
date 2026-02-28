/*
Migration: initialize data.meta.lastReadArticleAt for all users to current latest article timestamp.
Usage:
  node scripts/migrate-mark-articles-read.js [--apply]

Without --apply runs dry-run and prints how many users would be changed.
With --apply writes changes to DB.
*/

const db = require('../src/db');
const knex = db.knex;
const articlesUtil = require('../src/utils/articles');

async function migrate(apply = false) {
  console.log('Scanning latest article...');
  const info = articlesUtil.getLatestArticleInfo();
  const latest = info && info.latest ? Number(info.latest) : 0;
  console.log('Latest article timestamp:', latest, 'title:', info && info.title);
  if (!latest) {
    console.log('No articles found; nothing to do.');
    return;
  }
  const rows = await knex('users').select('id', 'discord_id', 'data');
  console.log(`Found ${rows.length} users`);
  let toChange = [];
  for (const row of rows) {
    let data;
    try { data = row.data ? JSON.parse(row.data) : {}; } catch (e) { continue; }
    data.meta = data.meta || {};
    const lastSeen = Number(data.meta.lastReadArticleAt || 0);
    if (lastSeen < latest) {
      toChange.push({ id: row.id, discord_id: row.discord_id, prev: lastSeen, next: latest });
    }
  }
  console.log(`Users needing update: ${toChange.length}`);
  if (!apply) {
    for (const u of toChange.slice(0, 20)) console.log('DRY:', u);
    if (toChange.length > 20) console.log('... (truncated)');
    return;
  }
  let changed = 0;
  for (const u of toChange) {
    const row = await knex('users').where({ id: u.id }).first();
    let data;
    try { data = row.data ? JSON.parse(row.data) : {}; } catch (e) { continue; }
    data.meta = data.meta || {};
    data.meta.lastReadArticleAt = latest;
    try {
      await knex('users').where({ id: u.id }).update({ data: JSON.stringify(data), updated_at: knex.fn.now() });
      changed++;
    } catch (e) {
      console.error('Failed writing user', u.discord_id, e && e.stack || e);
    }
  }
  console.log('Migration applied. users changed:', changed);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');

migrate(apply).then(() => process.exit(0)).catch(err => { console.error(err && err.stack || err); process.exit(2); });
