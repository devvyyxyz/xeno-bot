const db = require('../db');
const logger = require('../utils/logger').get('models:userResources');

async function ensureRow(userId) {
  const exists = await db.knex('user_resources').where({ user_id: String(userId) }).first();
  if (exists) return exists;
  await db.knex('user_resources').insert({ user_id: String(userId) });
  return db.knex('user_resources').where({ user_id: String(userId) }).first();
}

async function getResources(userId) {
  const row = await db.knex('user_resources').where({ user_id: String(userId) }).first();
  if (!row) return { royal_jelly: 0, pathogen_spores: 0, stabilizers: 0 };
  return { royal_jelly: Number(row.royal_jelly || 0), pathogen_spores: Number(row.pathogen_spores || 0), stabilizers: Number(row.stabilizers || 0) };
}

async function modifyResources(userId, deltas = {}) {
  await ensureRow(userId);
  const cur = await db.knex('user_resources').where({ user_id: String(userId) }).first();
  const payload = {};
  payload.royal_jelly = Number(cur.royal_jelly || 0) + Number(deltas.royal_jelly || 0);
  payload.pathogen_spores = Number(cur.pathogen_spores || 0) + Number(deltas.pathogen_spores || 0);
  payload.stabilizers = Number(cur.stabilizers || 0) + Number(deltas.stabilizers || 0);
  await db.knex('user_resources').where({ user_id: String(userId) }).update(payload);
  return getResources(userId);
}

module.exports = { ensureRow, getResources, modifyResources };
