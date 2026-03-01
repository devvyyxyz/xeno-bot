const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { ChannelType, PermissionsBitField } = require('discord.js');
const guildModel = require('../../models/guild');
const userModel = require('../../models/user');
const hostModel = require('../../models/host');
const xenoModel = require('../../models/xenomorph');
const emojis = require('../../../config/emojis.json');
const { getCommandConfig } = require('../../utils/commandsConfig');
const { buildNoticeV2Payload, buildStatsV2Payload } = require('../../utils/componentsV2');
const cmd = getCommandConfig('setup') || { name: 'setup', description: 'Manage bot settings for this server' };
const logger = require('../../utils/logger').get('command:setup');
const fallbackLogger = require('../../utils/fallbackLogger');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
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
    .addSubcommands((sub) =>
      sub.setName('message-delete')
        .setDescription('Toggle deleting the spawn message after it is caught')
        .addBooleanOptions(opt => opt.setName('enabled').setDescription('Enable deleting spawn messages after catch').setRequired(true))
    )
,
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const sendSetupNotice = async (target, message, tone = 'info', title = null) => {
      return safeReply(target, {
        ...buildNoticeV2Payload({ title, message, tone }),
        ephemeral: true
      }, { loggerName: 'command:setup' });
    };
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const subCfg = sub ? (getCommandConfig(`setup ${sub}`) || getCommandConfig(`setup.${sub}`)) : null;
    if (subCfg && subCfg.developerOnly) {
      const cfg = require('../../../config/config.json');
      const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
      if (!ownerId || interaction.user.id !== ownerId) {
        await sendSetupNotice(interaction, 'Only the bot developer/owner can run this subcommand.', 'permission');
        return;
      }
    }
    // permission: only server administrators or guild owner can change settings
    const memberPerms = interaction.memberPermissions;
    const ownerId = resolveOwnerId();
    const isOwnerBypass = ownerId && String(interaction.user.id) === String(ownerId);
    if (!isOwnerBypass && memberPerms && !memberPerms.has(PermissionsBitField.Flags.ManageGuild) && interaction.user.id !== interaction.guild.ownerId) {
      await sendSetupNotice(interaction, 'You need Manage Server permission to run this.', 'permission');
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (deferErr) {
      const logger = require('../../utils/logger').get('command:setup');
      const ageMs = Date.now() - (interaction.createdTimestamp || Date.now());
        try { require('../../utils/fallbackLogger').warn('Failed to defer reply for interaction', { error: deferErr && (deferErr.stack || deferErr), ageMs }); } catch (le) { fallbackLogger.warn('Failed logging defer reply failure in setup', le && (le.stack || le)); }
      // If the interaction is too old, bail quietly
      if (ageMs > 10000) return;
      // otherwise try to continue but avoid trying to reply later
    }

    // reuse previously resolved `sub` variable
    // const sub = interaction.options.getSubcommand();

    if (sub === 'reset') {
      const target = interaction.options.getUser('target');
      const defaults = require('../../../config/userDefaults.json');
      const gd = (defaults && defaults.guildDefaults) ? defaults.guildDefaults : { eggs: { classic: 1 }, items: {}, currency: { royal_jelly: 0 } };
      if (target) {
        try {
          await userModel.findOrCreate(String(target.id));
          const newData = { guilds: {}, stats: {} };
          newData.guilds[interaction.guildId] = { eggs: Object.assign({}, gd.eggs || { classic: 1 }), items: Object.assign({}, gd.items || {}), currency: Object.assign({}, gd.currency || { royal_jelly: 0 }) };
          await userModel.updateUserData(String(target.id), newData);
          // Also remove any hosts owned by this user
          try {
            await hostModel.deleteHostsByOwner(String(target.id));
          } catch (hostErr) {
            require('../../utils/logger').get('command:setup').warn('Failed to remove user hosts during reset', { error: hostErr && (hostErr.stack || hostErr) });
          }
          // Also remove any xenomorphs owned by this user
          try {
            await xenoModel.deleteXenosByOwner(String(target.id));
          } catch (xenoErr) {
            require('../../utils/logger').get('command:setup').warn('Failed to remove user xenomorphs during reset', { error: xenoErr && (xenoErr.stack || xenoErr) });
          }
          await sendSetupNotice(interaction, `Reset ${target.username}'s data to default values for this server. Removed hosts and xenomorphs owned by the user.`, 'info', '✅ Reset Complete');
        } catch (err) {
          await sendSetupNotice(interaction, `Failed to reset user: ${err && (err.message || err)}`, 'error');
        }
        return;
      } else {
        // server reset
        const defaults = require('../../../config/guildDefaults.json');
        await guildModel.upsertGuildConfig(interaction.guildId, { ...defaults });
        await sendSetupNotice(interaction, `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Server settings reset to default values.`, 'info', '✅ Reset Complete');
        return;
      }
    }

    if (sub === 'message-delete') {
      const enabled = interaction.options.getBoolean('enabled');
      try {
        const existing = await guildModel.getGuildConfig(interaction.guildId) || {};
        const data = existing.data || {};
        data.delete_spawn_message = enabled === true;
        await guildModel.upsertGuildConfig(interaction.guildId, { data });
        await sendSetupNotice(interaction, `Spawn message deletion after catch is now ${enabled ? 'enabled' : 'disabled'}.`, 'info');
      } catch (e) {
        await sendSetupNotice(interaction, `Failed to update setting: ${e && (e.message || e)}`, 'error');
      }
      return;
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        await sendSetupNotice(interaction, 'Please specify a valid text channel.', 'requirement');
        return;
      }
      const baseLogger = require('../../utils/logger');
      if (baseLogger && baseLogger.sentry) {
        try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.start', category: 'db', data: { guildId: interaction.guildId, channel: channel.id } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (db.upsertGuild.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging breadcrumb failure (db.upsertGuild.start)', le && (le.stack || le)); } catch (ignored) {} } }
      }
      await guildModel.upsertGuildConfig(interaction.guildId, { channel_id: channel.id });
      if (baseLogger && baseLogger.sentry) {
        try { baseLogger.sentry.addBreadcrumb({ message: 'db.upsertGuild.finish', category: 'db', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (db.upsertGuild.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging breadcrumb failure (db.upsertGuild.finish)', le && (le.stack || le)); } catch (ignored) {} } }
      }
      await sendSetupNotice(interaction, `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Egg spawn channel set to ${channel}.`, 'info');
        // Immediately spawn an egg in the new channel
        try {
          const spawnManager = require('../../spawnManager');
            if (spawnManager && typeof spawnManager.doSpawn === 'function') {
            if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.start', category: 'spawn', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.start)', le && (le.stack || le)); } catch (ignored) {} } } }
            await spawnManager.doSpawn(interaction.guildId);
            if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'spawn.doSpawn.finish', category: 'spawn', data: { guildId: interaction.guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (spawn.doSpawn.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (spawn.doSpawn.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
          }
        } catch (err) {
          // Log but don't fail the command
          require('../../utils/logger').get('command:setup').error('Failed to spawn egg after setting channel', { error: err && (err.stack || err) });
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
        await sendSetupNotice(interaction, 'Minimum must be at least 30 seconds.', 'requirement');
        return;
      }
      if (max > 21600) {
        await sendSetupNotice(interaction, 'Maximum cannot exceed 21600 seconds (6 hours).', 'requirement');
        return;
      }
      if (min > max) {
        await sendSetupNotice(interaction, 'Minimum cannot be greater than maximum.', 'requirement');
        return;
      }
      await guildModel.upsertGuildConfig(interaction.guildId, { spawn_min_seconds: min, spawn_max_seconds: max });
      try {
        const spawnManager = require('../../spawnManager');
        if (spawnManager && typeof spawnManager.requestReschedule === 'function') spawnManager.requestReschedule(interaction.guildId);
      } catch (e) { try { require('../../utils/logger').get('command:setup').warn('Failed to request spawn reschedule', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging requestReschedule error in setup', le && (le.stack || le)); } catch (ignored) {} } }
      await sendSetupNotice(interaction, `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Spawn rate set: min ${min}s, max ${max}s. (interpreted as ${units})`, 'info');
    } else if (sub === 'egg-limit') {
      const num = interaction.options.getInteger('number');
      await guildModel.upsertGuildConfig(interaction.guildId, { egg_limit: num });
      try {
        const spawnManager = require('../../spawnManager');
        if (spawnManager && typeof spawnManager.requestReschedule === 'function') spawnManager.requestReschedule(interaction.guildId);
      } catch (e) { try { require('../../utils/logger').get('command:setup').warn('Failed to request spawn reschedule', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging requestReschedule error in setup', le && (le.stack || le)); } catch (ignored) {} } }
      await sendSetupNotice(interaction, `${emojis.pressurised_with_artificial_grav || emojis.egg || ''} Egg limit set to ${num}.`, 'info');
    } else {
      if (sub === 'details') {
        try {
          const guildId = interaction.guildId;
          const cfg = await guildModel.getGuildConfig(guildId) || {};
          let nextSpawn = null;
          try { const row = await require('../../db').knex('guild_settings').where({ guild_id: guildId }).first('next_spawn_at'); nextSpawn = row && row.next_spawn_at ? Number(row.next_spawn_at) : null; } catch (e) {}

          const rows = [
            { label: 'Spawn Channel', value: cfg.channel_id ? `<#${cfg.channel_id}>` : 'Not set' },
            { label: 'Egg Limit', value: String(cfg.egg_limit ?? '1') },
            { label: 'Spawn Min / Max (s)', value: `${cfg.spawn_min_seconds ?? '60'} / ${cfg.spawn_max_seconds ?? '3600'}` }
          ];
          if (nextSpawn) rows.push({ label: 'Next scheduled spawn', value: new Date(nextSpawn).toLocaleString() });
          if (cfg && cfg.data && cfg.data.botAvatar) rows.push({ label: 'Avatar URL', value: String(cfg.data.botAvatar) });

          await safeReply(interaction, {
            ...buildStatsV2Payload({
              title: `Setup for ${interaction.guild?.name || guildId}`,
              rows,
              footer: 'Setup details'
            }),
            ephemeral: true
          }, { loggerName: 'command:setup' });
        } catch (e) {
          await sendSetupNotice(interaction, `Failed to fetch setup details: ${e && (e.message || e)}`, 'error');
        }
        return;
      }
      // New: avatar subcommand handling
      if (sub === 'avatar') {
        const attachment = interaction.options.getAttachment('image');
        const url = attachment?.url || interaction.options.getString('url');
        if (!url) {
          await sendSetupNotice(interaction, 'Please provide an image (attachment) or a URL.', 'requirement');
          return;
        }
        // store in guild config under data.botAvatar
        const guildModel = require('../../models/guild');
        const existing = await guildModel.getGuildConfig(interaction.guildId) || {};
        const data = existing.data || {};
        data.botAvatar = url;
        const baseLogger = require('../../utils/logger');
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
          await sendSetupNotice(interaction, 'Bot avatar updated for this server.', 'info');
        } else {
          await sendSetupNotice(interaction, 'Saved avatar to server config. Applying it automatically is not supported by this runtime; the avatar will be used where supported.', 'info');
        }
        return;
      }
      await sendSetupNotice(interaction, 'Unknown subcommand.', 'error');
    }
  },

  // text-mode handler removed; use slash command
};
