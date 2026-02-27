const { getCommandConfig } = require('../utils/commandsConfig');
const cmd = getCommandConfig('health') || { name: 'health', description: 'Show bot health (DB and telemetry)' };
const logger = require('../utils/logger').get('command:health');
const { knex } = require('../db');
const baseLogger = require('../utils/logger');

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const { EmbedBuilder } = require('discord.js');
    const cfg = require('../../config/config.json');
    const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the bot developer/owner can run this command.', flags: 64 });
      return;
    }
    const now = new Date();
    let dbStatus = '❌ FAILED';
    let dbInfo = '';
    let usersCount = 'n/a';
    let guildsCount = 'n/a';
    let dbError = null;
    try {
      await knex.raw('select 1 as result');
      const clientName = knex.client.config.client || 'unknown';
      dbStatus = '✅ OK';
      dbInfo = `Client: ${clientName}`;
      if (clientName === 'sqlite3') {
        const filename = knex.client.config.connection && knex.client.config.connection.filename;
        if (filename) dbInfo += ` | File: ${filename}`;
      } else if (process.env.DATABASE_URL) {
        try {
          const { URL } = require('url');
          const parsed = new URL(process.env.DATABASE_URL);
          dbInfo += ` | Host: ${parsed.hostname}` + (parsed.pathname ? ` | DB: ${parsed.pathname.replace('/', '')}` : '');
        } catch (e) {}
      }
      try {
        const u = await knex('users').count('* as c').first();
        usersCount = u && (u.c ?? u['count(*)']) ? String(u.c || u['count(*)']) : '0';
      } catch (e) { usersCount = 'err'; }
      try {
        const g = await knex('guild_settings').count('* as c').first();
        guildsCount = g && (g.c ?? g['count(*)']) ? String(g.c || g['count(*)']) : '0';
      } catch (e) { guildsCount = 'err'; }
    } catch (err) {
      dbError = err;
      logger.error('DB health check failed', { error: err.stack || err });
    }
    const sentryStatus = baseLogger.sentry ? '✅ Enabled' : '⚪ Disabled';
    const embed = new EmbedBuilder()
      .setTitle('Bot Health')
      .setColor(dbStatus === '✅ OK' ? 0x00c853 : 0xd32f2f)
      .addFields(
        { name: 'Database', value: dbStatus, inline: true },
        { name: 'Sentry', value: sentryStatus, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: 'DB Info', value: dbInfo || 'n/a', inline: false },
        { name: 'Users', value: usersCount, inline: true },
        { name: 'Guilds', value: guildsCount, inline: true },
        { name: 'Timestamp', value: now.toISOString(), inline: false }
      );
    if (dbError) {
      embed.addFields({ name: 'DB Error', value: String(dbError.message || dbError), inline: false });
    }
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
  // text-mode handler removed; use slash command
};
