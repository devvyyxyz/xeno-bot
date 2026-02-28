const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { ChannelType, PermissionsBitField } = require('discord.js');
const guildModel = require('../models/guild');
const userModel = require('../models/user');
const emojis = require('../../config/emojis.json');
const { getCommandConfig } = require('../utils/commandsConfig');
const cmd = getCommandConfig('setup') || { name: 'setup', description: 'Manage bot settings for this server' };
const logger = require('../utils/logger').get('command:setup');
const fallbackLogger = require('../utils/fallbackLogger');

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: ['ManageGuild'],
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description)
    .addSubcommands((sub) =>
      sub.setName('channel')
        .setDescription('Set the channel where eggs will spawn')
        .addChannelOptions(opt =>
          opt.setName('channel')
            .setDescription('The channel to use')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommands((sub) =>
      sub.setName('reset')
        .setDescription('Reset server settings or a user to defaults')
        .addUserOptions(opt => opt.setName('target').setDescription('User to reset').setRequired(false))
    )
    .addSubcommands((sub) =>
      sub.setName('spawn-rate')
        .setDescription('Set spawn rate bounds in seconds (min/max)')
        .addIntegerOptions(opt =>
          opt.setName('min')
            .setDescription('Minimum seconds between spawns (>=30)')
            .setRequired(true)
            .setMinValue(30)
        )
        .addIntegerOptions(opt =>
          opt.setName('max')
            .setDescription('Maximum seconds between spawns (<=21600)')
            .setRequired(true)
            .setMaxValue(21600)
        )
        .addStringOptions(opt =>
          opt.setName('units')
            .setDescription('Units for the provided min/max values')
            .addChoices({ name: 'seconds', value: 'seconds' }, { name: 'minutes', value: 'minutes' })
            .setRequired(false)
        )
    )
    .addSubcommands((sub) =>
      sub.setName('egg-limit')
        .setDescription('Set maximum eggs that can spawn at once')
        .addIntegerOptions(opt =>
          opt.setName('number')
            .setDescription('Maximum eggs')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommands((sub) =>
      sub.setName('avatar')
        .setDescription('Set a server-specific bot avatar (attachment or URL)')
        .addAttachmentOptions(opt =>
          opt.setName('image')
            .setDescription('Upload an image to use as the bot avatar for this server')
            .setRequired(false)
        )
        .addStringOptions(opt =>
          opt.setName('url')
            .setDescription('URL to an image to use as the bot avatar for this server')
            .setRequired(false)
        )
    )
      .addSubcommands((sub) =>
        sub.setName('details')
        .setDescription('Show this server\'s setup values')
      )
,
  async executeInteraction(interaction) {
    const safeReply = require('../utils/safeReply');
    // permission: only server administrators or guild owner can change settings
    const memberPerms = interaction.memberPermissions;
      if (memberPerms && !memberPerms.has(PermissionsBitField.Flags.ManageGuild) && interaction.user.id !== interaction.guild.ownerId) {
          await safeReply(interaction, { content: 'You need Manage Server permission to run this.', ephemeral: true }, { loggerName: 'command:setup' });
          return;
        }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (deferErr) {
      const logger = require('../utils/logger').get('command:setup');
      const ageMs = Date.now() - (interaction.createdTimestamp || Date.now());
        try { require('../utils/fallbackLogger').warn('Failed to defer reply for interaction', { error: deferErr && (deferErr.stack || deferErr), ageMs }); } catch (le) { fallbackLogger.warn('Failed logging defer reply failure in setup', le && (le.stack || le)); }
      // If the interaction is too old, bail quietly
      if (ageMs > 10000) return;
      // otherwise try to continue but avoid trying to reply later
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'reset') {
      const target = interaction.options.getUser('target');
      const defaults = require('../../config/userDefaults.json');
      const gd = (defaults && defaults.guildDefaults) ? defaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
      if (target) {
        try {
          await userModel.findOrCreate(String(target.id));
          const newData = { guilds: {}, stats: {} };
          newData.guilds[interaction.guildId] = { eggs: Object.assign({}, gd.eggs || { classic: 1 }), items: Object.assign({}, gd.items || {}), currency: Object.assign({}, gd.currency || { royal_jelly: 0 }) };
          await userModel.updateUserData(String(target.id), newData);
          const safeReply = require('../utils/safeReply');
          await safeReply(interaction, { content: `Reset ${target.username}'s data to default values for this server.`, ephemeral: true }, { loggerName: 'command:setup' });
        } catch (err) {
          const safeReply = require('../utils/safeReply');
          await safeReply(interaction, { content: `Failed to reset user: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:setup' });
        }
        return;
      } else {
        // server reset
        const defaults = require('../../config/guildDefaults.json');
        await guildModel.upsertGuildConfig(interaction.guildId, { ...defaults });
        const safeReply = require('../utils/safeReply');
        await safeReply(interaction, { content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Server settings reset to default values.`, ephemeral: true }, { loggerName: 'command:setup' });
        return;
      }
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        const safeReply = require('../utils/safeReply');
        await safeReply(interaction, { content: 'Please specify a valid text channel.', ephemeral: true }, { loggerName: 'command:setup' });
        return;
      }
      const baseLogger = require('../utils/logger');
      if (baseLogger && baseLogger.sentry) {
        try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.start', category: 'db', data: { guildId: interaction.guildId, channel: channel.id } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (db.upsertGuild.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging breadcrumb failure (db.upsertGuild.start)', le && (le.stack || le)); } catch (ignored) {} } }
      }
      await guildModel.upsertGuildConfig(interaction.guildId, { channel_id: channel.id });
      if (baseLogger && baseLogger.sentry) {
        try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.finish', category: 'db', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (db.upsertGuild.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging breadcrumb failure (db.upsertGuild.finish)', le && (le.stack || le)); } catch (ignored) {} } }
      }
      const safeReply = require('../utils/safeReply');
      await safeReply(interaction, { content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Egg spawn channel set to ${channel}.`, ephemeral: true }, { loggerName: 'command:setup' });
        // Immediately spawn an egg in the new channel
        try {
          const spawnManager = require('../spawnManager');
            if (spawnManager && typeof spawnManager.doSpawn === 'function') {
            if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.start', category: 'spawn', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.start)', le && (le.stack || le)); } catch (ignored) {} } } }
                        if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.start', category: 'spawn', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.start)', le && (le.stack || le)); } catch (ignored) {} } } }
            await spawnManager.doSpawn(interaction.guildId);
            if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.finish', category: 'spawn', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
                      if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.finish', category: 'spawn', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
          }
        } catch (err) {
          // Log but don't fail the command
          require('../utils/logger').get('command:setup').error('Failed to spawn egg after setting channel', { error: err && (err.stack || err) });
        }
    } else if (sub === 'spawn-rate') {
      const rawMin = interaction.options.getInteger('min');
      const rawMax = interaction.options.getInteger('max');
      const units = interaction.options.getString('units') || 'seconds';
      let min = Number(rawMin);
      let max = Number(rawMax);
      if (units === 'minutes') {
        min = min * 60;
        max = max * 60;
      }
      // validate (values are in seconds now)
      if (min < 30) {
        const safeReply = require('../utils/safeReply');
        await safeReply(interaction, { content: `Minimum must be at least 30 seconds.`, ephemeral: true }, { loggerName: 'command:setup' });
        return;
      }
      if (max > 21600) {
        const safeReply = require('../utils/safeReply');
        await safeReply(interaction, { content: `Maximum cannot exceed 21600 seconds (6 hours).`, ephemeral: true }, { loggerName: 'command:setup' });
        return;
      }
      if (min > max) {
        const safeReply = require('../utils/safeReply');
        await safeReply(interaction, { content: `Minimum cannot be greater than maximum.`, ephemeral: true }, { loggerName: 'command:setup' });
        return;
      }
      await guildModel.upsertGuildConfig(interaction.guildId, { spawn_min_seconds: min, spawn_max_seconds: max });
      try {
        const spawnManager = require('../spawnManager');
        if (spawnManager && typeof spawnManager.requestReschedule === 'function') spawnManager.requestReschedule(interaction.guildId);
      } catch (e) { try { require('../utils/logger').get('command:setup').warn('Failed to request spawn reschedule', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging requestReschedule error in setup', le && (le.stack || le)); } catch (ignored) {} } }
      await safeReply(interaction, { content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Spawn rate set: min ${min}s, max ${max}s. (interpreted as ${units})`, ephemeral: true }, { loggerName: 'command:setup' });
    } else if (sub === 'egg-limit') {
      const num = interaction.options.getInteger('number');
      await guildModel.upsertGuildConfig(interaction.guildId, { egg_limit: num });
      try {
        const spawnManager = require('../spawnManager');
        if (spawnManager && typeof spawnManager.requestReschedule === 'function') spawnManager.requestReschedule(interaction.guildId);
      } catch (e) { try { require('../utils/logger').get('command:setup').warn('Failed to request spawn reschedule', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging requestReschedule error in setup', le && (le.stack || le)); } catch (ignored) {} } }
      await safeReply(interaction, { content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Egg limit set to ${num}.`, ephemeral: true }, { loggerName: 'command:setup' });
    } else {
      if (sub === 'details') {
        try {
          const safeReply = require('../utils/safeReply');
          const { EmbedBuilder } = require('discord.js');
          const guildId = interaction.guildId;
          const cfg = await guildModel.getGuildConfig(guildId) || {};
          let nextSpawn = null;
          try { const row = await require('../db').knex('guild_settings').where({ guild_id: guildId }).first('next_spawn_at'); nextSpawn = row && row.next_spawn_at ? Number(row.next_spawn_at) : null; } catch (e) {}
          const embed = new EmbedBuilder()
            .setTitle(`Setup for ${interaction.guild?.name || guildId}`)
            .setColor(0x66ccff)
            .addFields(
              { name: 'Spawn Channel', value: cfg.channel_id ? `<#${cfg.channel_id}>` : 'Not set', inline: true },
              { name: 'Egg Limit', value: String(cfg.egg_limit ?? '1'), inline: true },
              { name: 'Spawn Min / Max (s)', value: `${cfg.spawn_min_seconds ?? '60'} / ${cfg.spawn_max_seconds ?? '3600'}`, inline: true }
            )
            .setTimestamp();
          if (nextSpawn) embed.addFields({ name: 'Next scheduled spawn', value: new Date(nextSpawn).toLocaleString(), inline: true });
          if (cfg && cfg.data && cfg.data.botAvatar) embed.setThumbnail(cfg.data.botAvatar);
          await safeReply(interaction, { embeds: [embed] });
        } catch (e) {
          const safeReply = require('../utils/safeReply');
          await safeReply(interaction, { content: `Failed to fetch setup details: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:setup' });
        }
        return;
      }
      // New: avatar subcommand handling
      if (sub === 'avatar') {
        const attachment = interaction.options.getAttachment('image');
        const url = attachment?.url || interaction.options.getString('url');
        if (!url) {
          const safeReply = require('../utils/safeReply');
          await safeReply(interaction, { content: 'Please provide an image (attachment) or a URL.', ephemeral: true }, { loggerName: 'command:setup' });
          return;
        }
        // store in guild config under data.botAvatar
        const guildModel = require('../models/guild');
        const existing = await guildModel.getGuildConfig(interaction.guildId) || {};
        const data = existing.data || {};
        data.botAvatar = url;
        const baseLogger = require('../utils/logger');
        if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.start', category: 'db', data: { guildId: interaction.guildId, botAvatar: url } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (db.upsertGuild.start)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (db.upsertGuild.start)', le && (le.stack || le)); } } }
        await guildModel.upsertGuildConfig(interaction.guildId, { data });
        if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.finish', category: 'db', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (db.upsertGuild.finish)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (db.upsertGuild.finish)', le && (le.stack || le)); } } }

        // Attempt to apply guild-specific avatar if supported by library/runtime
        let applied = false;
        try {
          const guild = interaction.guild;
          const me = guild && (guild.members && (guild.members.me || (typeof guild.members.fetchMe === 'function' && (await guild.members.fetchMe()))));
          if (me && typeof me.setAvatar === 'function') {
            await me.setAvatar(url);
            applied = true;
          }
        } catch (err) {
          // ignore apply errors; we'll inform user
        }

        if (applied) {
          await safeReply(interaction, { content: 'Bot avatar updated for this server.', ephemeral: true }, { loggerName: 'command:setup' });
        } else {
          await safeReply(interaction, { content: 'Saved avatar to server config. Applying it automatically is not supported by this runtime; the avatar will be used where supported.', ephemeral: true }, { loggerName: 'command:setup' });
        }
        return;
      }
      await safeReply(interaction, { content: 'Unknown subcommand.', ephemeral: true }, { loggerName: 'command:setup' });
    }
  },

  // text-mode handler removed; use slash command
};
