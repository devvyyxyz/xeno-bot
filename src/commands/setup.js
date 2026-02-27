const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { ChannelType, PermissionsBitField } = require('discord.js');
const guildModel = require('../models/guild');
const userModel = require('../models/user');
const emojis = require('../../config/emojis.json');
const { getCommandConfig } = require('../utils/commandsConfig');
const cmd = getCommandConfig('setup') || { name: 'setup', description: 'Manage bot settings for this server' };

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
,
  async executeInteraction(interaction) {
    // permission: only server administrators or guild owner can change settings
    const memberPerms = interaction.memberPermissions;
      if (memberPerms && !memberPerms.has(PermissionsBitField.Flags.ManageGuild) && interaction.user.id !== interaction.guild.ownerId) {
      await interaction.reply({ content: 'You need Manage Server permission to run this.', flags: 64 });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (deferErr) {
      const logger = require('../utils/logger').get('command:setup');
      const ageMs = Date.now() - (interaction.createdTimestamp || Date.now());
      try { logger.warn('Failed to defer reply for interaction', { error: deferErr && (deferErr.stack || deferErr), ageMs }); } catch {}
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
          await interaction.editReply({ content: `Reset ${target.username}'s data to default values for this server.` });
        } catch (err) {
          await interaction.editReply({ content: `Failed to reset user: ${err && (err.message || err)}` });
        }
        return;
      } else {
        // server reset
        const defaults = require('../../config/guildDefaults.json');
        await guildModel.upsertGuildConfig(interaction.guildId, { ...defaults });
        await interaction.editReply({ content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Server settings reset to default values.` });
        return;
      }
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        await interaction.editReply({ content: 'Please specify a valid text channel.' });
        return;
      }
      const baseLogger = require('../utils/logger');
      if (baseLogger && baseLogger.sentry) {
        try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.start', category: 'db', data: { guildId: interaction.guildId, channel: channel.id } }); } catch {}
      }
      await guildModel.upsertGuildConfig(interaction.guildId, { channel_id: channel.id });
      if (baseLogger && baseLogger.sentry) {
        try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.finish', category: 'db', data: { guildId: interaction.guildId } }); } catch {}
      }
      await interaction.editReply({ content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Egg spawn channel set to ${channel}.` });
        // Immediately spawn an egg in the new channel
        try {
          const spawnManager = require('../spawnManager');
            if (spawnManager && typeof spawnManager.doSpawn === 'function') {
            if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.start', category: 'spawn', data: { guildId: interaction.guildId } }); } catch {} }
            await spawnManager.doSpawn(interaction.guildId);
            if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.finish', category: 'spawn', data: { guildId: interaction.guildId } }); } catch {} }
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
        await interaction.editReply({ content: `Minimum must be at least 30 seconds.` });
        return;
      }
      if (max > 21600) {
        await interaction.editReply({ content: `Maximum cannot exceed 21600 seconds (6 hours).` });
        return;
      }
      if (min > max) {
        await interaction.editReply({ content: `Minimum cannot be greater than maximum.` });
        return;
      }
      await guildModel.upsertGuildConfig(interaction.guildId, { spawn_min_seconds: min, spawn_max_seconds: max });
      try {
        const spawnManager = require('../spawnManager');
        if (spawnManager && typeof spawnManager.requestReschedule === 'function') spawnManager.requestReschedule(interaction.guildId);
      } catch (e) { try { require('../utils/logger').get('command:setup').warn('Failed to request spawn reschedule', { error: e && (e.stack || e) }); } catch {} }
      await interaction.editReply({ content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Spawn rate set: min ${min}s, max ${max}s. (interpreted as ${units})` });
    } else if (sub === 'egg-limit') {
      const num = interaction.options.getInteger('number');
      await guildModel.upsertGuildConfig(interaction.guildId, { egg_limit: num });
      try {
        const spawnManager = require('../spawnManager');
        if (spawnManager && typeof spawnManager.requestReschedule === 'function') spawnManager.requestReschedule(interaction.guildId);
      } catch (e) { try { require('../utils/logger').get('command:setup').warn('Failed to request spawn reschedule', { error: e && (e.stack || e) }); } catch {} }
      await interaction.editReply({ content: `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Egg limit set to ${num}.` });
    } else {
      // New: avatar subcommand handling
      if (sub === 'avatar') {
        const attachment = interaction.options.getAttachment('image');
        const url = attachment?.url || interaction.options.getString('url');
        if (!url) {
          await interaction.editReply({ content: 'Please provide an image (attachment) or a URL.' });
          return;
        }
        // store in guild config under data.botAvatar
        const guildModel = require('../models/guild');
        const existing = await guildModel.getGuildConfig(interaction.guildId) || {};
        const data = existing.data || {};
        data.botAvatar = url;
        const baseLogger = require('../utils/logger');
        if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.start', category: 'db', data: { guildId: interaction.guildId, botAvatar: url } }); } catch {} }
        await guildModel.upsertGuildConfig(interaction.guildId, { data });
        if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.finish', category: 'db', data: { guildId: interaction.guildId } }); } catch {} }

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
          await interaction.editReply({ content: 'Bot avatar updated for this server.' });
        } else {
          await interaction.editReply({ content: 'Saved avatar to server config. Applying it automatically is not supported by this runtime; the avatar will be used where supported.' });
        }
        return;
      }
      await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  },

  // text-mode handler removed; use slash command
};
