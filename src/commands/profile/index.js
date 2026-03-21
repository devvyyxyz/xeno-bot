const { getCommandConfig } = require('../../utils/commandsConfig');
const profileModel = require('../../models/profile');
const userModel = require('../../models/user');
const db = require('../../db');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} = require('discord.js');
const safeReply = require('../../utils/safeReply');
const fallbackLogger = require('../../utils/fallbackLogger');

const cmd = getCommandConfig('profile') || {
  name: 'profile',
  description: 'View or edit a user profile.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      {
        name: 'view',
        description: 'View a user profile',
        type: 1, // SUB_COMMAND
        options: [
          { name: 'user', description: 'User to view', type: 6, required: false }
        ]
      },
      {
        name: 'edit',
        description: 'Edit your profile (only allowed fields)',
        type: 1,
        options: [
          { name: 'field', description: 'Field to edit: avatar_url, banner_url, user_type, faction', type: 3, required: true },
          { name: 'value', description: 'New value for the field', type: 3, required: true }
        ]
      }
    ]
  },

  async executeInteraction(interaction) {
    try {
      await interaction.deferReply({ ephemeral: cmd.ephemeral === true });
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') {
        const target = interaction.options.getUser('user') || interaction.user;
        const profile = await profileModel.getProfile(String(target.id));
        const user = await userModel.getUserByDiscordId(String(target.id));
        const stats = userModel.getUserStats(user || {});

        // compute simple leaderboard rank (using catches as proxy)
        let rankInfo = 'n/a';
        try {
          const totalForUserRow = await db.knex('egg_catches').where({ user_id: String(target.id) }).sum('amount as c').first();
          const totalForUser = totalForUserRow && (totalForUserRow.c || totalForUserRow['sum(`amount`)']) ? Number(totalForUserRow.c || totalForUserRow['sum(`amount`)']) : 0;
          const higherRaw = await db.knex.raw('SELECT COUNT(*) as c FROM (SELECT user_id, SUM(amount) as s FROM egg_catches GROUP BY user_id HAVING s > ?) as t', [totalForUser]);
          const higher = (higherRaw && higherRaw.rows && higherRaw.rows[0] && higherRaw.rows[0].c) || (higherRaw && higherRaw[0] && higherRaw[0].c) || 0;
          const totalUsersRaw = await db.knex.raw('SELECT COUNT(DISTINCT user_id) as c FROM egg_catches');
          const totalUsers = (totalUsersRaw && totalUsersRaw.rows && totalUsersRaw.rows[0] && totalUsersRaw.rows[0].c) || (totalUsersRaw && totalUsersRaw[0] && totalUsersRaw[0].c) || 0;
          rankInfo = `${(Number(higher) + 1)}/${Number(totalUsers) || 'n'}`;
        } catch (e) {
          try { require('../../utils/logger').get('command:profile').warn('Failed computing leaderboard rank', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard rank error', le && (le.stack || le)); } catch (ignored) { /* ignore */ void 0; } }
        }

        const container = new ContainerBuilder();
        const displayName = target.discriminator && target.discriminator !== '0' ? `${target.username}#${target.discriminator}` : target.username;
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${displayName} — Profile`)
        );

        // Avatar: prefer profile avatar_url, fall back to user's avatar
        let avatarUrl = profile.avatar_url;
        try {
          if (!avatarUrl && typeof target.displayAvatarURL === 'function') avatarUrl = target.displayAvatarURL({ size: 512, extension: 'png' });
        } catch (e) { avatarUrl = avatarUrl || null; }
        if (avatarUrl) container.addThumbnailComponents(new ThumbnailBuilder().setURL(avatarUrl));

        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));

        // Banner: prefer profile banner_url, else use bot's avatar as banner fallback
        let bannerUrl = profile.banner_url;
        try {
          if (!bannerUrl && interaction && interaction.client && interaction.client.user && typeof interaction.client.user.displayAvatarURL === 'function') {
            bannerUrl = interaction.client.user.displayAvatarURL({ size: 1024, extension: 'png' });
          }
        } catch (e) { bannerUrl = bannerUrl || null; }

        const lines = [];
        lines.push(`**Faction:** ${profile.faction || 'none'}`);
        lines.push(`**Global rank:** ${rankInfo}`);
        lines.push(`**User type:** ${profile.user_type || 'member'}`);
        lines.push(`**Catches:** ${stats.catches || 0}`);
        lines.push(`**Banner:** ${bannerUrl || 'none'}`);

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

        await safeReply(interaction, { components: [container], flags: MessageFlags.IsComponentsV2 }, { loggerName: 'command:profile' });
        return;
      }

      if (sub === 'edit') {
        const field = interaction.options.getString('field');
        const value = interaction.options.getString('value');
        const allowed = ['avatar_url', 'banner_url', 'user_type', 'faction'];
        if (!allowed.includes(field)) {
          await safeReply(interaction, { content: 'That field cannot be edited.' }, { loggerName: 'command:profile' });
          return;
        }
        try {
          const updated = await profileModel.setProfileField(String(interaction.user.id), field, value);
          await safeReply(interaction, { content: `Profile updated: ${field} set.` }, { loggerName: 'command:profile' });
        } catch (e) {
          let msg = 'Failed to update profile.';
          if (e && e.message === 'invalid_user_type') msg = `Invalid user_type. Allowed: ${profileModel.getAllowedUserTypes().join(', ')}`;
          if (e && e.message === 'invalid_url') msg = 'Invalid URL provided.';
          if (e && e.message === 'invalid_faction') msg = 'Invalid faction value.';
          await safeReply(interaction, { content: msg }, { loggerName: 'command:profile' });
        }
        return;
      }
    } catch (err) {
      try {
        require('../../utils/logger').get('command:profile').warn('Command failed', { error: err && (err.stack || err) });
      } catch (e) { try { fallbackLogger.warn('Failed logging profile command error', e && (e.stack || e)); } catch (ignored) { /* ignore */ void 0; } }
      // Do not send a public/non-ephemeral reply here; rethrow and let the
      // global interaction handler send a single ephemeral error reply.
      throw err;
    }
  }
};
