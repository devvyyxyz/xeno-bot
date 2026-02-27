const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const emojis = require('../../config/emojis.json');
const spawnManager = require('../spawnManager');
const { getCommandConfig } = require('../utils/commandsConfig');
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
      await interaction.reply({ content: 'You need Manage Server permission to run this.', flags: 64 });
      return;
    }
    let didDefer = false;
    let didReply = false;
    // Try to acknowledge quickly with an ephemeral reply first to avoid token expiry/race
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Triggering spawn...', ephemeral: true });
        didReply = true;
      }
    } catch (replyErr) {
      // reply failed — fallback to defer
      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: false });
          didDefer = true;
        } else {
          didDefer = interaction.deferred === true;
        }
      } catch (deferErr) {
        try { require('../utils/logger').get('command:forcespawn').warn('Failed to defer reply after reply failed', { error: deferErr && (deferErr.stack || deferErr) }); } catch {}
        const ageMs = Date.now() - (interaction.createdTimestamp || Date.now());
        if (ageMs > 10000) return;
        didDefer = interaction.deferred === true;
      }
    }

    const safeReply = require('../utils/safeReply');

    try {
      const eggTypeId = interaction.options.getString('eggtype');
      const baseLogger = require('../utils/logger');
      if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.start', category: 'spawn', data: { guildId: interaction.guildId, eggTypeId } }); } catch {} }
      let spawned = false;
      if (typeof spawnManager.forceSpawn === 'function') {
        spawned = await spawnManager.forceSpawn(interaction.guildId, eggTypeId);
      } else {
        spawned = await spawnManager.doSpawn(interaction.guildId, eggTypeId);
      }
      if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.finish', category: 'spawn', data: { guildId: interaction.guildId, eggTypeId } }); } catch {} }
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