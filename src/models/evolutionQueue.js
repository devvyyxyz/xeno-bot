const db = require('../db');
const logger = require('../utils/logger').get('models:evolutionQueue');

async function addToQueue({ xeno_id, user_id, hive_id = null, target_role, durationMs = 0, cost_jelly = 0, stabilizer_used = false }) {
  const now = Date.now();
  const finishes = now + Number(durationMs || 0);
  const payload = { xeno_id, user_id: String(user_id), hive_id, target_role, started_at: now, finishes_at: finishes, cost_jelly: Number(cost_jelly || 0), stabilizer_used: !!stabilizer_used, status: 'queued' };
  const inserted = await db.knex('evolution_queue').insert(payload);
  const id = Array.isArray(inserted) ? inserted[0] : inserted;
  return db.knex('evolution_queue').where({ id }).first();
}

async function listForUser(userId) {
  return db.knex('evolution_queue').where({ user_id: String(userId) }).orderBy('finishes_at', 'asc');
}

module.exports = { addToQueue, listForUser };
