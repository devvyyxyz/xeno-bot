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
      const topEggs = Object.entries(eggTotalsByType).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ k, v }));
      const topEggsGuild = Object.entries(guildData.eggs || {}).sort((a, b) => (Number(b[1]||0) - Number(a[1]||0))).slice(0, 5).map(([k, v]) => ({ k, v }));
      // currencies
      const guildCurrencyLines = Object.entries(guildData.currency || {}).map(([k, v]) => ({ k, v }));
      const globalCurrencyLines = Object.entries(currencyTotals).map(([k, v]) => ({ k, v }));
      const royal = await userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly');

      const accountCreated = user && user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : 'n/a';

      // Leaderboard rank by catches using SQL on egg_catches (more scalable)
      let rankInfo = 'n/a';
      try {
        const totalForUserRow = await db.knex('egg_catches').where({ user_id: String(target.id) }).sum('amount as c').first();
        const totalForUser = totalForUserRow && (totalForUserRow.c || totalForUserRow['sum(`amount`)']) ? Number(totalForUserRow.c || totalForUserRow['sum(`amount`)']) : 0;
        // count users with strictly higher totals
        const higherRaw = await db.knex.raw('SELECT COUNT(*) as c FROM (SELECT user_id, SUM(amount) as s FROM egg_catches GROUP BY user_id HAVING s > ?) as t', [totalForUser]);
        const higher = (higherRaw && higherRaw.rows && higherRaw.rows[0] && higherRaw.rows[0].c) || (higherRaw && higherRaw[0] && higherRaw[0].c) || (higherRaw && higherRaw.length && higherRaw[0].c) || 0;
        // total users
        const totalUsersRaw = await db.knex.raw('SELECT COUNT(DISTINCT user_id) as c FROM egg_catches');
        const totalUsers = (totalUsersRaw && totalUsersRaw.rows && totalUsersRaw.rows[0] && totalUsersRaw.rows[0].c) || (totalUsersRaw && totalUsersRaw[0] && totalUsersRaw[0].c) || (totalUsersRaw && totalUsersRaw.length && totalUsersRaw[0].c) || 0;
        rankInfo = `${(Number(higher) + 1)}/${Number(totalUsers) || 'n'}`;
      } catch (e) {
        try { require('../utils/logger').get('command:stats').warn('Failed computing leaderboard rank', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard rank error', le && (le.stack || le)); } catch (ignored) {} }
      }

      // Compute per-egg rates accurately using egg_catches events (server & global)
      let serverEggCounts = {};
      let globalEggCounts = {};
      let firstCatchAt = null;
      try {
        const srows = await db.knex('egg_catches').where({ user_id: String(target.id), guild_id: guildId }).select('egg_id').sum('amount as c').groupBy('egg_id');
        for (const r of srows) serverEggCounts[r.egg_id] = Number(r.c || r['sum(`amount`)'] || 0);
        const grow = await db.knex('egg_catches').where({ user_id: String(target.id) }).select('egg_id').sum('amount as c').groupBy('egg_id');
        for (const r of grow) globalEggCounts[r.egg_id] = Number(r.c || r['sum(`amount`)'] || 0);
        const firstRow = await db.knex('egg_catches').where({ user_id: String(target.id) }).min('caught_at as m').first();
        firstCatchAt = firstRow && (firstRow.m || firstRow['min(`caught_at`)']) ? new Date(firstRow.m || firstRow['min(`caught_at`)']) : null;
      } catch (e) {
        try { require('../utils/logger').get('command:stats').warn('Failed fetching egg_catches for rates', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging egg_catches fetch error', le && (le.stack || le)); } catch (ignored) {} }
      }
      const now = Date.now();
      const daysSince = firstCatchAt ? Math.max((now - firstCatchAt.getTime()) / 86400000, 1/24) : Math.max((Date.now() - (global._softUptimeStart || Date.now())) / 86400000, 1/24);
      const fmtRate = (n) => `${(n / daysSince).toFixed(2)}/day`;

      const embed = new EmbedBuilder()
        .setTitle(`${target.username}#${target.discriminator} — Game Stats`)
        .setColor(require('../utils/commandsConfig').getCommandsObject().colour || 0xbab25d)
        .setThumbnail(typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null)
        .addFields(
          { name: 'Performance', value: `Catches: ${stats.catches || 0}\nAvg: ${msToHuman(stats.avg || null)}\nFastest: ${msToHuman(stats.fastest || null)}\nSlowest: ${msToHuman(stats.slowest || null)}\nLeaderboard: ${rankInfo}`, inline: false },
          { name: 'Inventory', value: `(this server) Eggs: ${totalEggs} | Items: ${totalItems}\n(global) Eggs: ${globalEggs} | Items: ${globalItems}`, inline: false },
          { name: 'Top Eggs', value: `(this server) ${topEggsGuild.length ? topEggsGuild.map(e => `${e.k}: ${e.v} (${fmtRate(e.v)})`).join('\n') : 'none'}\n(global) ${topEggs.length ? topEggs.map(e => `${e.k}: ${e.v} (${fmtRate(e.v)})`).join('\n') : 'none'}`, inline: false },
          { name: 'Currency', value: `(this server) ${guildCurrencyLines.length ? guildCurrencyLines.map(c => `${c.k}: ${c.v}`).join(', ') : `royal_jelly: ${royal || 0}`}\n(global) ${globalCurrencyLines.length ? globalCurrencyLines.map(c => `${c.k}: ${c.v}`).join(', ') : 'none'}`, inline: false },
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
