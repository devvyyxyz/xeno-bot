const db = require('../db');
const userModel = require('../models/user');
const hostModel = require('../models/host');
const xenoModel = require('../models/xenomorph');
const itemsService = require('../services/items');
const logger = require('../utils').logger.get('utils:trades');
const { parseJSON } = require('./format/jsonParse');

function emptyOffer() {
  return { eggs: {}, items: {}, hosts: [], xenos: [] };
}

async function createTrade(initiatorId, recipientId, guildId, initiatorOffer) {
  const row = await db.knex('trades').insert({ initiator_id: String(initiatorId), recipient_id: String(recipientId), guild_id: String(guildId), initiator_offer: JSON.stringify(initiatorOffer || emptyOffer()), status: 'pending' });
  const id = Array.isArray(row) ? row[0] : row;
  return db.knex('trades').where({ id }).first();
}

async function getTradeById(id) {
  return db.knex('trades').where({ id: Number(id) }).first();
}

async function updateTrade(id, patch) {
  await db.knex('trades').where({ id: Number(id) }).update({ ...patch, updated_at: db.knex.fn.now() });
  return getTradeById(id);
}

async function cancelTrade(id) {
  await updateTrade(id, { status: 'cancelled' });
  return getTradeById(id);
}

/**
 * Transfer eggs from one user to another.
 * @param {string} fromUserId - User ID to transfer from
 * @param {string} toUserId - User ID to transfer to
 * @param {string} guildId - Guild ID
 * @param {object} eggMap - Object mapping egg IDs to quantities
 */
async function transferEggs(fromUserId, toUserId, guildId, eggMap = {}) {
  for (const [eggId, qty] of Object.entries(eggMap)) {
    const quantity = Number(qty);
    if (quantity <= 0) continue;
    await userModel.removeEggsForGuild(fromUserId, guildId, eggId, quantity);
    await userModel.addEggsForGuild(toUserId, guildId, quantity, eggId);
  }
}

/**
 * Transfer items from one user to another.
 * @param {string} fromUserId - User ID to transfer from
 * @param {string} toUserId - User ID to transfer to
 * @param {string} guildId - Guild ID
 * @param {object} itemMap - Object mapping item IDs to quantities
 */
async function transferItems(fromUserId, toUserId, guildId, itemMap = {}) {
  for (const [itemId, qty] of Object.entries(itemMap)) {
    const quantity = Number(qty);
    if (quantity <= 0) continue;
    await itemsService.consumeItemForUser(fromUserId, guildId, { id: itemId }, quantity);
    await userModel.addItemForGuild(toUserId, guildId, itemId, quantity);
  }
}

/**
 * Transfer hosts from one user to another.
 * @param {string} fromUserId - User ID to transfer from (for logging)
 * @param {string} toUserId - User ID to transfer to
 * @param {array} hostIds - Array of host IDs to transfer
 */
async function transferHosts(fromUserId, toUserId, hostIds = []) {
  for (const hid of hostIds) {
    const hostId = Number(hid);
    if (!hostId) continue;
    await db.knex('hosts').where({ id: hostId }).update({ owner_id: toUserId });
  }
}

/**
 * Transfer xenomorphs from one user to another and detach from hives.
 * @param {string} fromUserId - User ID to transfer from (for logging)
 * @param {string} toUserId - User ID to transfer to
 * @param {array} xenoIds - Array of xenomorph IDs to transfer
 */
async function transferXenos(fromUserId, toUserId, xenoIds = []) {
  for (const xid of xenoIds) {
    const xenoId = Number(xid);
    if (!xenoId) continue;
    await db.knex('xenomorphs').where({ id: xenoId }).update({ owner_id: toUserId, hive_id: null });
  }
}

// Validate that the owner still controls offered assets and return a normalized offer summary
async function validateOfferOwnership(offer, ownerId, guildId) {
  const problems = [];
  // eggs
  const eggKeys = Object.keys(offer.eggs || {});
  if (eggKeys.length) {
    const user = await userModel.getUserByDiscordId(ownerId);
    const guildData = user?.data?.guilds?.[guildId] || { eggs: {} };
    for (const k of eggKeys) {
      const want = Number(offer.eggs[k] || 0);
      const have = Number(guildData.eggs?.[k] || 0);
      if (have < want) problems.push({ type: 'egg', id: k, want, have });
    }
  }
  // items - check counts via itemsService or userModel
  const itemKeys = Object.keys(offer.items || {});
  if (itemKeys.length) {
    const user = await userModel.getUserByDiscordId(ownerId);
    const guildData = user?.data?.guilds?.[guildId] || { items: {} };
    for (const k of itemKeys) {
      const want = Number(offer.items[k] || 0);
      const have = Number(guildData.items?.[k] || 0);
      if (have < want) problems.push({ type: 'item', id: k, want, have });
    }
  }
  // hosts
  for (const hid of offer.hosts || []) {
    const host = await hostModel.getHostById(hid, guildId);
    if (!host || String(host.owner_id) !== String(ownerId)) problems.push({ type: 'host', id: hid });
  }
  // xenos
  for (const xid of offer.xenos || []) {
    const xeno = await xenoModel.getByIdScoped(xid, guildId);
    if (!xeno || String(xeno.owner_id) !== String(ownerId)) problems.push({ type: 'xeno', id: xid });
  }

  return problems;
}

// Apply a trade inside a DB transaction. Returns { success: true } or { success: false, error }
async function applyTrade(tradeRow) {
  const trx = await db.knex.transaction();
  try {
    const initiator = tradeRow.initiator_id;
    const recipient = tradeRow.recipient_id;
    const guildId = tradeRow.guild_id;
    const a = parseJSON(tradeRow.initiator_offer, {}, 'initiator_offer');
    const b = parseJSON(tradeRow.recipient_offer, {}, 'recipient_offer');

    // Re-validate ownership inside transaction (simple checks)
    const aProblems = await validateOfferOwnership(a, initiator, guildId);
    const bProblems = await validateOfferOwnership(b, recipient, guildId);
    if (aProblems.length || bProblems.length) {
      await trx.rollback();
      return { success: false, error: 'ownership_mismatch', details: { aProblems, bProblems } };
    }

    // Transfer initiator's offer to recipient
    await transferEggs(initiator, recipient, guildId, a.eggs);
    await transferItems(initiator, recipient, guildId, a.items);
    await transferHosts(initiator, recipient, a.hosts);
    await transferXenos(initiator, recipient, a.xenos);

    // Transfer recipient's offer to initiator
    await transferEggs(recipient, initiator, guildId, b.eggs);
    await transferItems(recipient, initiator, guildId, b.items);
    await transferHosts(recipient, initiator, b.hosts);
    await transferXenos(recipient, initiator, b.xenos);

    await db.knex('trades').where({ id: tradeRow.id }).update({ status: 'accepted', updated_at: db.knex.fn.now() });
    await trx.commit();
    return { success: true };
  } catch (err) {
    try { await trx.rollback(); } catch (_) { /* ignore */ }
    logger.error('Failed applying trade', { err: err && (err.stack || err) });
    return { success: false, error: 'apply_failed', details: err && (err.stack || err) };
  }
}

module.exports = { emptyOffer, createTrade, getTradeById, updateTrade, cancelTrade, validateOfferOwnership, applyTrade };

