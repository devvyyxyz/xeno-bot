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
      // totals for this guild
      const totalEggs = Object.values(guildData.eggs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      const totalItems = Object.values(guildData.items || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      // global totals across all guilds
      const allGuilds = (user && user.data && user.data.guilds) || {};
      let globalEggs = 0, globalItems = 0;
      const eggTotalsByType = {};
      const currencyTotals = {};
      for (const [gId, gData] of Object.entries(allGuilds)) {
        const eggs = gData.eggs || {};
        for (const [etype, qty] of Object.entries(eggs)) {
          const n = Number(qty || 0);
          globalEggs += n;
          eggTotalsByType[etype] = (eggTotalsByType[etype] || 0) + n;
        }
        const items = gData.items || {};
        for (const qty of Object.values(items)) globalItems += Number(qty || 0);
        const curr = gData.currency || {};
        for (const [ck, cv] of Object.entries(curr)) currencyTotals[ck] = (currencyTotals[ck] || 0) + Number(cv || 0);
      }
      // top egg types
      const topEggs = Object.entries(eggTotalsByType).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}: ${v}`);
      const topEggsGuild = Object.entries(guildData.eggs || {}).sort((a, b) => (Number(b[1]||0) - Number(a[1]||0))).slice(0, 3).map(([k, v]) => `${k}: ${v}`);
      // currencies
      const guildCurrencyLines = Object.entries(guildData.currency || {}).map(([k, v]) => `${k}: ${v}`);
      const globalCurrencyLines = Object.entries(currencyTotals).map(([k, v]) => `${k}: ${v}`);
      const royal = await userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly');

      const accountCreated = user && user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : 'n/a';

      const embed = new EmbedBuilder()
        .setTitle(`${target.username}#${target.discriminator} — Game Stats`)
        .setColor(0x00b2ff)
        .setThumbnail(typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null)
        .addFields(
          { name: 'Performance', value: `Catches: ${stats.catches || 0}\nPurrfect: ${stats.purrfect || 0} (${((stats.purrfect || 0) && stats.catches ? Math.round(100 * (stats.purrfect || 0) / stats.catches) : 0)}%)\nAvg: ${msToHuman(stats.avg || null)}\nFastest: ${msToHuman(stats.fastest || null)}\nSlowest: ${msToHuman(stats.slowest || null)}`, inline: false },
          { name: 'Inventory (this server)', value: `Eggs: ${totalEggs}\nItems: ${totalItems}`, inline: true },
          { name: 'Inventory (global)', value: `Eggs: ${globalEggs}\nItems: ${globalItems}`, inline: true },
          { name: 'Top Eggs (this server)', value: topEggsGuild.length ? topEggsGuild.join('\n') : 'none', inline: true },
          { name: 'Top Eggs (global)', value: topEggs.length ? topEggs.join('\n') : 'none', inline: true },
          { name: 'Currency (this server)', value: guildCurrencyLines.length ? guildCurrencyLines.join('\n') : `royal_jelly: ${royal || 0}`, inline: false },
          { name: 'Currency (global)', value: globalCurrencyLines.length ? globalCurrencyLines.join('\n') : 'none', inline: false },
          { name: 'Misc', value: `Account created: ${accountCreated}\nUser ID: ${target.id}`, inline: false }
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
