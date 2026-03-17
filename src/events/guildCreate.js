const utils = require('../utils');
const logger = utils.logger.get('guildCreate');
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { buildLinkButtons } = utils.buttonBuilder;
const guildJoinWorker = require('../workers/guildJoinWorker');
const guildJoinLib = require('../lib/guildJoin');

module.exports = {
  name: 'guildCreate',
  once: false,
  sendGuildJoinV2Webhook: guildJoinLib.sendGuildJoinV2Webhook,
  async execute(guild, client) {
    try {
      // Enqueue guild join work to background worker and return quickly.
      try {
        if (guildJoinWorker && typeof guildJoinWorker.enqueueGuildJoin === 'function') {
          guildJoinWorker.enqueueGuildJoin({ guildId: guild.id }).catch((e) =>
            logger.warn('Failed enqueuing guild join job', { guildId: guild.id, error: e && (e.stack || e) })
          );
          return;
        }
      } catch (e) {
        logger.warn('guildJoinWorker not available to enqueue; falling back', { error: e && (e.stack || e) });
      }

      // Fallback: attempt to send webhook synchronously (best-effort)
      try {
        await guildJoinLib.sendGuildJoinV2Webhook({ guild, client });
      } catch (e) {
        logger.warn('Fallback guild join webhook failed', { guildId: guild.id, error: e && (e.stack || e) });
      }
    } catch (err) {
      logger.error('Unhandled error enqueuing guildCreate work', { guildId: guild && guild.id, error: err && (err.stack || err) });
    }
  }
};
