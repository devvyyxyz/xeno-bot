const utils = require('../utils');
const logger = utils.logger.get('guildDelete');

module.exports = {
  name: 'guildDelete',
  once: false,
  async execute(guild) {
    try {
      const guildId = String(guild.id);
      
      // Clean up spawnManager state for this guild
      try {
        const spawnManager = require('../spawnManager');
        if (spawnManager && typeof spawnManager.cleanupGuild === 'function') {
          await spawnManager.cleanupGuild(guildId);
          logger.debug('Cleaned up spawnManager state for guild', { guildId, guildName: guild.name });
        }
      } catch (e) {
        logger.warn('Failed to cleanup spawnManager on guildDelete', { guildId, error: e && (e.stack || e) });
      }

      // Clean up hatchManager state for this guild
      try {
        const hatchManager = require('../services/hatchManager');
        if (hatchManager && typeof hatchManager.cleanupGuild === 'function') {
          await hatchManager.cleanupGuild(guildId);
          logger.debug('Cleaned up hatchManager state for guild', { guildId, guildName: guild.name });
        }
      } catch (e) {
        logger.warn('Failed to cleanup hatchManager on guildDelete', { guildId, error: e && (e.stack || e) });
      }

      logger.info('Guild deleted, cleanup complete', { guildId, guildName: guild.name });
    } catch (err) {
      logger.error('Unhandled error in guildDelete', { guildId: guild?.id, error: err && (err.stack || err) });
    }
  }
};
