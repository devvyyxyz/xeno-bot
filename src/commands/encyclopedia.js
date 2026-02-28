const { getCommandConfig } = require('../utils/commandsConfig');
const eggTypes = require('../../config/eggTypes.json');
const fallbackLogger = require('../utils/fallbackLogger');
// userModel not needed here
const eggModel = require('../models/egg');
const emojis = require('../utils/emojis');
const createInteractionCollector = require('../utils/collectorHelper');

const cmd = getCommandConfig('encyclopedia') || {
  name: 'encyclopedia',
  description: 'Show all eggs and their stats.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    try {
      // Use flags: 64 for ephemeral, omit for public
      if (cmd.ephemeral === true) {
        await interaction.deferReply({ flags: 64 });
      } else {
        await interaction.deferReply();
      }
    } catch (err) {
      // If the interaction is already expired, just return
      const logger = require('../utils/logger').get('command:encyclopedia');
      logger.error('Failed to defer reply', { error: err && (err.stack || err) });
      return;
    }
    const guildId = interaction.guildId;
    // Ensure all egg types exist in DB for this guild
    const baseLogger = require('../utils/logger');
    const logger = baseLogger.get ? baseLogger.get('command:encyclopedia') : console;
    if (baseLogger && baseLogger.sentry) {
      try {
        baseLogger.sentry.addBreadcrumb({ message: 'db.ensureEggTypes.start', category: 'db', data: { guildId } });
      } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (ensureEggTypes.start)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (ensureEggTypes.start)', le && (le.stack || le)); } }
    }
      await eggModel.ensureEggTypesForGuild(guildId, eggTypes);
    if (baseLogger && baseLogger.sentry) {
      try {
        baseLogger.sentry.addBreadcrumb({ message: 'db.ensureEggTypes.finish', category: 'db', data: { guildId } });
      } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (ensureEggTypes.finish)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (ensureEggTypes.finish)', le && (le.stack || le)); } }
    }
    // Get stats from DB
    if (baseLogger && baseLogger.sentry) {
      try {
        baseLogger.sentry.addBreadcrumb({ message: 'db.getEggStats.start', category: 'db', data: { guildId } });
      } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (getEggStats.start)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (getEggStats.start)', le && (le.stack || le)); } }
    }
    const stats = await eggModel.getEggStatsForGuild(guildId);
    if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.getEggStats.finish', category: 'db', data: { guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (db.getEggStats.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb failure (db.getEggStats.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
    const totalWeight = eggTypes.reduce((a, b) => a + b.weight, 0);
    const hiddenEmoji = emojis.get('egg_hidden');
    const eggsPerPage = 9;
    const pages = [];
    for (let i = 0; i < eggTypes.length; i += eggsPerPage) {
      const fields = eggTypes.slice(i, i + eggsPerPage).map(egg => {
        const chance = ((egg.weight / totalWeight) * 100).toFixed(2);
        const value = (egg.rarity !== undefined && egg.rarity !== null) ? String(egg.rarity) : '1';
        const amount = (stats[egg.id] !== undefined && stats[egg.id] !== null) ? String(stats[egg.id]) : '0';
        const emoji = amount !== '0' ? egg.emoji : hiddenEmoji;
        let name = `${emoji} **${egg.name} (${chance}%)**`;
        let val = `${value} value\n${amount} in this server`;
        if (!name || typeof name !== 'string' || name.trim().length === 0) name = 'Unknown Egg';
        if (!val || typeof val !== 'string' || val.trim().length === 0) val = 'No data';
        if (name.length > 256) name = name.slice(0, 253) + '...';
        if (val.length > 1024) val = val.slice(0, 1021) + '...';
        return { name, value: val, inline: true };
      });
      pages.push(fields);
    }
    const { EmbedBuilder, ActionRowBuilder } = require('discord.js');
    const { SecondaryButtonBuilder } = require('@discordjs/builders');
    let page = 0;
    const getEmbed = (pageIdx) => new EmbedBuilder()
      .setTitle('📚 The Catalogue')
      .setColor(cmd.embedColor || 0x00b2ff)
      .setFooter({ text: `Page ${pageIdx + 1} of ${pages.length}` })
      .addFields(pages[pageIdx]);
    const row = new ActionRowBuilder().addComponents(
      new SecondaryButtonBuilder().setCustomId('prev').setLabel('Previous').setDisabled(page === 0),
      new SecondaryButtonBuilder().setCustomId('next').setLabel('Next').setDisabled(page === pages.length - 1)
    );
    await interaction.editReply({ embeds: [getEmbed(page)], components: [row] });
    if (pages.length === 1) return;
    const { collector, message: msg } = await createInteractionCollector(interaction, { embeds: [getEmbed(page)], components: [row], time: 120_000, ephemeral: cmd.ephemeral === true, edit: true });
    if (!collector) {
      try { const l = require('../utils/logger').get('command:encyclopedia'); l && l.warn && l.warn('Failed to attach encyclopedia collector'); } catch (le) { try { fallbackLogger.warn('Failed to attach encyclopedia collector', le && (le.stack || le)); } catch (ignored) {} }
      return;
    }
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Only the command user can change pages.', ephemeral: true });
      if (i.customId === 'prev' && page > 0) page--;
      if (i.customId === 'next' && page < pages.length - 1) page++;
      const newRow = new ActionRowBuilder().addComponents(
        new SecondaryButtonBuilder().setCustomId('prev').setLabel('Previous').setDisabled(page === 0),
        new SecondaryButtonBuilder().setCustomId('next').setLabel('Next').setDisabled(page === pages.length - 1)
      );
      await i.update({ embeds: [getEmbed(page)], components: [newRow] });
    });
    collector.on('end', async () => {
      try { await interaction.editReply({ components: [] }); } catch (e) { try { const l = require('../utils/logger').get('command:encyclopedia'); l && l.warn && l.warn('Failed clearing components after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging encyclopedia component clear failure', le && (le.stack || le)); } catch (ignored) {} } }
    });
  }
};
