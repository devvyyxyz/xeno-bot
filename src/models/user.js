const db = require('../db');
const logger = require('../utils/logger').get('models:user');
const userDefaults = require('../../config/userDefaults.json');

async function getUserByDiscordId(discordId) {
  const row = await db.knex('users').where({ discord_id: discordId }).first();
  if (!row) return null;
  try {
    const data = row.data ? JSON.parse(row.data) : null;
    return { id: row.id, discord_id: row.discord_id, data, created_at: row.created_at, updated_at: row.updated_at };
  } catch (err) {
    logger.error('Failed parsing user data JSON', { discordId, error: err.stack || err });
    return { id: row.id, discord_id: row.discord_id, data: null };
  }
}

async function createUser(discordId, initialData = {}) {
  const defaults = { guilds: {}, stats: {} };
  const gd = (userDefaults && userDefaults.guildDefaults) ? userDefaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
  const dataToStore = Object.assign({}, defaults, initialData || {});
  dataToStore.guilds = dataToStore.guilds || {};
  const inserted = await db.knex('users').insert({ discord_id: discordId, data: JSON.stringify(dataToStore) });
  const id = Array.isArray(inserted) ? inserted[0] : inserted;
  logger.info('Created user', { discordId, id });
  return getUserByDiscordId(discordId);
}

async function updateUserData(discordId, newData) {
  const updated = await db.knex('users').where({ discord_id: discordId }).update({ data: JSON.stringify(newData), updated_at: db.knex.fn.now() });
  if (!updated) return null;
  return getUserByDiscordId(discordId);
}

async function findOrCreate(discordId, defaults = {}) {
  let user = await getUserByDiscordId(discordId);
  if (user) return user;
  return createUser(discordId, defaults);
}

async function updateUserDataRawById(userId, newData) {
  try {
    await db.knex('users').where({ id: userId }).update({ data: JSON.stringify(newData), updated_at: db.knex.fn.now() });
  } catch (err) {
    logger.error('Failed to update user data (raw)', { userId, error: err.stack || err });
    throw err;
  }
}


// Add eggs to a user's inventory for a guild, per egg type, and track stats
async function addEggsForGuild(discordId, guildId, eggs, eggTypeId, catchTimeMs = null) {
  let user = await getUserByDiscordId(discordId);
  if (!user) {
    await createUser(discordId, {});
    user = await getUserByDiscordId(discordId);
  }
  const data = user.data || {};
  data.guilds = data.guilds || {};
  // ensure guild defaults from config
  const gdDefaults = (userDefaults && userDefaults.guildDefaults) ? userDefaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
  data.guilds[guildId] = data.guilds[guildId] || { eggs: Object.assign({}, gdDefaults.eggs || { classic: 1 }), items: Object.assign({}, gdDefaults.items || {}), currency: Object.assign({}, gdDefaults.currency || { royal_jelly: 0 }) };
  if (!data.guilds[guildId].eggs || typeof data.guilds[guildId].eggs !== 'object') data.guilds[guildId].eggs = Object.assign({}, gdDefaults.eggs || { classic: 1 });
  if (!data.guilds[guildId].items || typeof data.guilds[guildId].items !== 'object') data.guilds[guildId].items = Object.assign({}, gdDefaults.items || {});
  if (!data.guilds[guildId].currency || typeof data.guilds[guildId].currency !== 'object') data.guilds[guildId].currency = Object.assign({}, gdDefaults.currency || { royal_jelly: 0 });
  data.guilds[guildId].eggs[eggTypeId] = (data.guilds[guildId].eggs[eggTypeId] || 0) + Number(eggs || 1);

  // Stats tracking
  data.stats = data.stats || {};
  data.stats.catches = (data.stats.catches || 0) + 1;
  if (catchTimeMs !== null) {
    data.stats.catchTimes = data.stats.catchTimes || [];
    data.stats.catchTimes.push(catchTimeMs);
    // Keep only last 1000 catch times for memory
    if (data.stats.catchTimes.length > 1000) data.stats.catchTimes.shift();
    // Purrfect catch: <2s
    if (catchTimeMs <= 2000) {
      data.stats.purrfect = (data.stats.purrfect || 0) + 1;
    }
  }
  // Increment egg caught count in DB
  try {
    const eggModel = require('./egg');
    await eggModel.incrementEggCaught(guildId, eggTypeId, Number(eggs || 1));
  } catch (e) {
    // Log but don't block user update if DB fails
    require('../utils/logger').get('models:user').error('Failed to increment egg caught in DB', { error: e.stack || e });
  }
  await updateUserDataRawById(user.id, data);
  return data.guilds[guildId].eggs[eggTypeId];
}
// Get stats for a user
function getUserStats(user) {
  const stats = (user?.data?.stats) || {};
  const catches = stats.catches || 0;
  const catchTimes = stats.catchTimes || [];
  const purrfect = stats.purrfect || 0;
  let fastest = null, slowest = null, avg = null;
  if (catchTimes.length > 0) {
    fastest = Math.min(...catchTimes);
    slowest = Math.max(...catchTimes);
    avg = catchTimes.reduce((a, b) => a + b, 0) / catchTimes.length;
  }
  return {
    catches,
    fastest,
    slowest,
    avg,
    purrfect
  };
}


async function getGuildStats(discordId, guildId) {
  const user = await getUserByDiscordId(discordId);
  if (!user) return { eggs: 0 };
  const data = user.data || {};
  const g = (data.guilds && data.guilds[guildId]) || { eggs: 0 };
  return { eggs: Number(g.eggs || 0) };
}

// Get all users (for leaderboard)
async function getAllUsers() {
  const rows = await db.knex('users').select('discord_id', 'data');
  return rows.map(row => ({ discord_id: row.discord_id, data: row.data ? JSON.parse(row.data) : {} }));
}

// Add a generic item to a user's inventory for a guild
async function addItemForGuild(discordId, guildId, itemId, quantity = 1) {
  let user = await getUserByDiscordId(discordId);
  if (!user) {
    await createUser(discordId, {});
    user = await getUserByDiscordId(discordId);
  }
  const data = user.data || {};
  data.guilds = data.guilds || {};
  // ensure guild defaults
  const gdDefaults2 = (userDefaults && userDefaults.guildDefaults) ? userDefaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
  data.guilds[guildId] = data.guilds[guildId] || { eggs: Object.assign({}, gdDefaults2.eggs || { classic: 1 }), items: Object.assign({}, gdDefaults2.items || {}), currency: Object.assign({}, gdDefaults2.currency || { royal_jelly: 0 }) };
  if (!data.guilds[guildId].items || typeof data.guilds[guildId].items !== 'object') data.guilds[guildId].items = Object.assign({}, gdDefaults2.items || {});
  if (!data.guilds[guildId].eggs || typeof data.guilds[guildId].eggs !== 'object') data.guilds[guildId].eggs = Object.assign({}, gdDefaults2.eggs || { classic: 1 });
  if (!data.guilds[guildId].currency || typeof data.guilds[guildId].currency !== 'object') data.guilds[guildId].currency = Object.assign({}, gdDefaults2.currency || { royal_jelly: 0 });
  data.guilds[guildId].items[itemId] = (data.guilds[guildId].items[itemId] || 0) + Number(quantity || 1);
  await updateUserDataRawById(user.id, data);
  return data.guilds[guildId].items[itemId];
}

// Remove eggs from a user's inventory for a guild. Throws if insufficient eggs.
async function removeEggsForGuild(discordId, guildId, eggId, quantity = 1) {
  const user = await getUserByDiscordId(discordId);
  if (!user) throw new Error('User not found');
  const data = user.data || {};
  data.guilds = data.guilds || {};
  const gdDefaults = (userDefaults && userDefaults.guildDefaults) ? userDefaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
  data.guilds[guildId] = data.guilds[guildId] || { eggs: Object.assign({}, gdDefaults.eggs || { classic: 1 }), items: Object.assign({}, gdDefaults.items || {}), currency: Object.assign({}, gdDefaults.currency || { royal_jelly: 0 }) };
  if (!data.guilds[guildId].eggs || typeof data.guilds[guildId].eggs !== 'object') data.guilds[guildId].eggs = Object.assign({}, gdDefaults.eggs || { classic: 1 });
  const cur = Number(data.guilds[guildId].eggs[eggId] || 0);
  const qty = Number(quantity || 1);
  if (cur < qty) throw new Error('Insufficient eggs');
  const newQty = cur - qty;
  if (newQty <= 0) {
    delete data.guilds[guildId].eggs[eggId];
  } else {
    data.guilds[guildId].eggs[eggId] = newQty;
  }
  await updateUserDataRawById(user.id, data);
  return newQty;
}

// Remove an item from a user's inventory for a guild. Throws if insufficient quantity.
async function removeItemForGuild(discordId, guildId, itemId, quantity = 1) {
  const user = await getUserByDiscordId(discordId);
  if (!user) throw new Error('User not found');
  const data = user.data || {};
  data.guilds = data.guilds || {};
  const gdDefaults = (userDefaults && userDefaults.guildDefaults) ? userDefaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
  data.guilds[guildId] = data.guilds[guildId] || { eggs: Object.assign({}, gdDefaults.eggs || { classic: 1 }), items: Object.assign({}, gdDefaults.items || {}), currency: Object.assign({}, gdDefaults.currency || { royal_jelly: 0 }) };
  if (!data.guilds[guildId].items || typeof data.guilds[guildId].items !== 'object') data.guilds[guildId].items = Object.assign({}, gdDefaults.items || {});
  const cur = Number(data.guilds[guildId].items[itemId] || 0);
  const qty = Number(quantity || 1);
  if (cur < qty) throw new Error('Insufficient items');
  const newQty = cur - qty;
  if (newQty <= 0) {
    delete data.guilds[guildId].items[itemId];
  } else {
    data.guilds[guildId].items[itemId] = newQty;
  }
  await updateUserDataRawById(user.id, data);
  return newQty;
}

// Modify currency (delta can be negative). Returns new amount.
async function modifyCurrencyForGuild(discordId, guildId, currencyKey, delta = 0) {
  let user = await getUserByDiscordId(discordId);
  if (!user) {
    await createUser(discordId, {});
    user = await getUserByDiscordId(discordId);
  }
  const data = user.data || {};
  data.guilds = data.guilds || {};
  const gdDefaults2 = (userDefaults && userDefaults.guildDefaults) ? userDefaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
  data.guilds[guildId] = data.guilds[guildId] || { eggs: Object.assign({}, gdDefaults2.eggs || { classic: 1 }), items: Object.assign({}, gdDefaults2.items || {}), currency: Object.assign({}, gdDefaults2.currency || { royal_jelly: 0 }) };
  if (!data.guilds[guildId].currency || typeof data.guilds[guildId].currency !== 'object') data.guilds[guildId].currency = Object.assign({}, gdDefaults2.currency || { royal_jelly: 0 });
  const curVal = Number(data.guilds[guildId].currency[currencyKey] || 0);
  const newVal = curVal + Number(delta);
  data.guilds[guildId].currency[currencyKey] = newVal;
  await updateUserDataRawById(user.id, data);
  return newVal;
}

async function getCurrencyForGuild(discordId, guildId, currencyKey) {
  const user = await getUserByDiscordId(discordId);
  if (!user) return 0;
  const data = user.data || {};
  const g = data.guilds && data.guilds[guildId];
  if (!g || !g.currency) return 0;
  return Number(g.currency[currencyKey] || 0);
}

module.exports = {
  getUserByDiscordId,
  createUser,
  updateUserData,
  updateUserDataRawById,
  findOrCreate,
  addEggsForGuild,
  addItemForGuild,
  removeEggsForGuild,
  modifyCurrencyForGuild,
  getCurrencyForGuild,
  getGuildStats,
  getUserStats,
  removeItemForGuild,
  getAllUsers
};



