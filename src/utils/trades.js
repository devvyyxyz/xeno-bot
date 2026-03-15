const db = require('../db');
const userModel = require('../models/user');
const hostModel = require('../models/host');
const xenoModel = require('../models/xenomorph');
const itemsService = require('../services/items');
const logger = require('../utils').logger.get('utils:trades');

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
    const a = JSON.parse(tradeRow.initiator_offer || '{}');
    const b = JSON.parse(tradeRow.recipient_offer || '{}');

    // Re-validate ownership inside transaction (simple checks)
    const aProblems = await validateOfferOwnership(a, initiator, guildId);
    const bProblems = await validateOfferOwnership(b, recipient, guildId);
    if (aProblems.length || bProblems.length) {
      await trx.rollback();
      return { success: false, error: 'ownership_mismatch', details: { aProblems, bProblems } };
    }

    // Remove eggs/items from initiator and add to recipient
    for (const [eggId, qty] of Object.entries(a.eggs || {})) {
      await userModel.removeEggsForGuild(initiator, guildId, eggId, Number(qty));
      await userModel.addEggsForGuild(recipient, guildId, Number(qty), eggId);
    }
    for (const [itemId, qty] of Object.entries(a.items || {})) {
      // consume from initiator
      await itemsService.consumeItemForUser(initiator, guildId, { id: itemId }, Number(qty));
      await userModel.addItemForGuild(recipient, guildId, itemId, Number(qty));
    }
    for (const hid of a.hosts || []) {
      await db.knex('hosts').where({ id: Number(hid) }).update({ owner_id: recipient });
    }
    for (const xid of a.xenos || []) {
      await db.knex('xenomorphs').where({ id: Number(xid) }).update({ owner_id: recipient, hive_id: null });
    }

    // Remove eggs/items from recipient and add to initiator
    for (const [eggId, qty] of Object.entries(b.eggs || {})) {
      await userModel.removeEggsForGuild(recipient, guildId, eggId, Number(qty));
      await userModel.addEggsForGuild(initiator, guildId, Number(qty), eggId);
    }
    for (const [itemId, qty] of Object.entries(b.items || {})) {
      await itemsService.consumeItemForUser(recipient, guildId, { id: itemId }, Number(qty));
      await userModel.addItemForGuild(initiator, guildId, itemId, Number(qty));
    }
    for (const hid of b.hosts || []) {
      await db.knex('hosts').where({ id: Number(hid) }).update({ owner_id: initiator });
    }
    for (const xid of b.xenos || []) {
      await db.knex('xenomorphs').where({ id: Number(xid) }).update({ owner_id: initiator, hive_id: null });
    }

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
