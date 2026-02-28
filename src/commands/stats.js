const { getCommandConfig } = require('../utils/commandsConfig');
const userModel = require('../models/user');
const { EmbedBuilder } = require('discord.js');
const fallbackLogger = require('../utils/fallbackLogger');

const cmd = getCommandConfig('stats') || {
  name: 'stats',
  description: 'View stats about a user.'
};

function msToHuman(ms) {
  if (ms === null || ms === undefined) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(2);
  return `${sec}s`;
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      {
        name: 'user',
        description: 'User to view stats for',
        type: 6, // USER
        required: false
      }
    ]
  },
  async executeInteraction(interaction) {
    try {
      await interaction.deferReply({ ephemeral: false });
      const target = interaction.options.getUser('user') || interaction.user;
      const baseLogger = require('../utils/logger');
      if (baseLogger && baseLogger.sentry) {
        try {
          baseLogger.sentry.addBreadcrumb({ message: 'db.getUser.start', category: 'db', data: { userId: target.id } });
        } catch (e) {
          try { require('../utils/logger').get('command:stats').warn('Failed to add sentry breadcrumb (db.getUser.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging stat breadcrumb error (db.getUser.start)', le && (le.stack || le)); } catch (ignored) {} }
        }
      }

      const user = await userModel.getUserByDiscordId(String(target.id));
      if (baseLogger && baseLogger.sentry) {
        try {
          baseLogger.sentry.addBreadcrumb({ message: 'db.getUser.finish', category: 'db', data: { userId: target.id } });
        } catch (e) {
          try { require('../utils/logger').get('command:stats').warn('Failed to add sentry breadcrumb (db.getUser.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging stat breadcrumb error (db.getUser.finish)', le && (le.stack || le)); } catch (ignored) {} }
        }
      }

      const stats = userModel.getUserStats(user || {});
      const guildId = interaction.guildId;
      const guildData = (user && user.data && user.data.guilds && user.data.guilds[guildId]) || { eggs: {}, items: {}, currency: {} };
      const totalEggs = Object.values(guildData.eggs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      const totalItems = Object.values(guildData.items || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      const royal = await userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly');

      const embed = new EmbedBuilder()
        .setTitle(`${target.username}'s Game Stats`)
        .setColor(0x00b2ff)
        .setThumbnail(typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null)
        .addFields(
          { name: 'Catches', value: String(stats.catches || 0), inline: true },
          { name: 'Purrfect', value: String(stats.purrfect || 0), inline: true },
          { name: 'Avg Catch', value: msToHuman(stats.avg || null), inline: true },
          { name: 'Fastest', value: msToHuman(stats.fastest || null), inline: true },
          { name: 'Slowest', value: msToHuman(stats.slowest || null), inline: true },
          { name: 'Total Eggs (this server)', value: String(totalEggs), inline: true },
          { name: 'Total Items (this server)', value: String(totalItems), inline: true },
          { name: 'Royal Jelly', value: String(royal || 0), inline: true }
        )
        .setFooter({ text: 'Game stats' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      try {
        await interaction.editReply({ content: 'Failed to fetch stats or interaction expired.' });
      } catch (e) {
        try { require('../utils/logger').get('command:stats').warn('Failed to send failure reply in stats command', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging failed-reply in stats command', le && (le.stack || le)); } catch (ignored) {} }
      }
      throw err;
    }
  },
  // text-mode handler removed; use slash command
};
