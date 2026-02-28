const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const emojis = require('../../config/emojis.json');
const spawnManager = require('../spawnManager');
const safeReply = require('../utils/safeReply');
const { getCommandConfig } = require('../utils/commandsConfig');
const fallbackLogger = require('../utils/fallbackLogger');
const cmd = getCommandConfig('forcespawn') || { name: 'forcespawn', description: 'Force spawn eggs in the configured channel (admin only)', category: 'Admin' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: ['ManageGuild'],
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description)
    .addStringOptions(option =>
      option.setName('eggtype')
        .setDescription('Which egg type to spawn (optional)')
        .setRequired(false)
        .setAutocomplete(true)
    ),
    async autocomplete(interaction) {
      const eggTypes = require('../../config/eggTypes.json');
      const autocomplete = require('../utils/autocomplete');
      return autocomplete(interaction, eggTypes, { map: e => ({ name: e.name, value: e.id }), max: 25 });
    },
  async executeInteraction(interaction) {
    const memberPerms = interaction.memberPermissions;
    if (memberPerms && !memberPerms.has(PermissionsBitField.Flags.ManageGuild) && interaction.user.id !== interaction.guild.ownerId) {
      const safeReply = require('../utils/safeReply');
      await safeReply(interaction, { content: 'You need Manage Server permission to run this.', ephemeral: true }, { loggerName: 'command:forcespawn' });
      return;
    }
    // Acknowledge command to avoid interaction expiry; safeReply will handle defer/edit as needed
    try {
      await safeReply(interaction, { content: 'Triggering spawn...', ephemeral: true }, { loggerName: 'command:forcespawn' });
    } catch (e) {
      const logger = require('../utils/logger').get('command:forcespawn');
      logger && logger.warn && logger.warn('Acknowledgement failed for forcespawn', { error: e && (e.stack || e) });
      // still attempt spawn
    }

    try {
      const eggTypeId = interaction.options.getString('eggtype');
      const baseLogger = require('../utils/logger');
      const logger = baseLogger && baseLogger.get ? baseLogger.get('command:forcespawn') : console;
      if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.start', category: 'spawn', data: { guildId: interaction.guildId, eggTypeId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.start)', le && (le.stack || le)); } catch (ignored) {} } } }
      let spawned = false;
      if (typeof spawnManager.forceSpawn === 'function') {
        spawned = await spawnManager.forceSpawn(interaction.guildId, eggTypeId);
      } else {
        spawned = await spawnManager.doSpawn(interaction.guildId, eggTypeId);
      }
      if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.finish', category: 'spawn', data: { guildId: interaction.guildId, eggTypeId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
      if (spawned) {
        await safeReply(interaction, { content: `${emojis.egg || ''} Forced egg spawn triggered${eggTypeId ? `: ${eggTypeId}` : ''}!` }, { loggerName: 'command:forcespawn' });
      } else {
        await safeReply(interaction, { content: `No spawn occurred: a spawn recently happened. Try again in a few seconds.`, ephemeral: true }, { loggerName: 'command:forcespawn' });
      }
    } catch (err) {
      const logger = require('../utils/logger').get('command:forcespawn');
      logger.error('Failed to force spawn eggs', { error: err && (err.stack || err) });
      await safeReply(interaction, { content: `Failed to force spawn eggs: ${err && err.message ? err.message : 'Unknown error'}`, ephemeral: true }, { loggerName: 'command:forcespawn' });
    }
  }
};