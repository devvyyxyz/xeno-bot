const egg = require('./egg');
const evolutionQueue = require('./evolutionQueue');
const guild = require('./guild');
const hive = require('./hive');
const host = require('./host');
const leaderboardBlacklist = require('./leaderboardBlacklist');
const user = require('./user');
const userResources = require('./userResources');
const xenomorph = require('./xenomorph');
const profile = require('./profile');

// Export models with both short and explicit `*Model` names for clarity and
// backwards compatibility. Prefer importing via `const { userModel } = require('./models');`
module.exports = {
  // short names (existing)
  egg,
  evolutionQueue,
  guild,
  hive,
  host,
  leaderboardBlacklist,
  user,
  userResources,
  xenomorph,
  profile,

  // explicit model aliases
  eggModel: egg,
  evolutionQueueModel: evolutionQueue,
  guildModel: guild,
  hiveModel: hive,
  hostModel: host,
  leaderboardBlacklistModel: leaderboardBlacklist,
  userModel: user,
  userResourcesModel: userResources,
  xenomorphModel: xenomorph
  ,
  profileModel: profile
};
