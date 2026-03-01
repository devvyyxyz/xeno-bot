const { getCommandConfig } = require('../../utils/commandsConfig');
const eggTypes = require('../../../config/eggTypes.json');
const fallbackLogger = require('../../utils/fallbackLogger');
const eggModel = require('../../models/egg');
const emojis = require('../../utils/emojis');
const createInteractionCollector = require('../../utils/collectorHelper');
const safeReply = require('../../utils/safeReply');

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
      if (cmd.ephemeral === true) {
        await interaction.deferReply({ flags: 64 });
      } else {
        await interaction.deferReply();
      }
    } catch (err) {
      const logger = require('../../utils/logger').get('command:encyclopedia');
      logger.error('Failed to defer reply', { error: err && (err.stack || err) });
      return;
    }
    const guildId = interaction.guildId;
    const baseLogger = require('../../utils/logger');
    const logger = baseLogger.get ? baseLogger.get('command:encyclopedia') : console;
    if (baseLogger && baseLogger.sentry) {
      try { baseLogger.sentry.addBreadcrumb({ message: 'db.ensureEggTypes.start', category: 'db', data: { guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (ensureEggTypes.start)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (ensureEggTypes.start)', le && (le.stack || le)); } }
    }
    await eggModel.ensureEggTypesForGuild(guildId, eggTypes);
    if (baseLogger && baseLogger.sentry) {
      try { baseLogger.sentry.addBreadcrumb({ message: 'db.ensureEggTypes.finish', category: 'db', data: { guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (ensureEggTypes.finish)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (ensureEggTypes.finish)', le && (le.stack || le)); } }
    }
    if (baseLogger && baseLogger.sentry) {
      try { baseLogger.sentry.addBreadcrumb({ message: 'db.getEggStats.start', category: 'db', data: { guildId } }); } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (getEggStats.start)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (getEggStats.start)', le && (le.stack || le)); } }
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
    let currentView = 'eggs';
    // Build host pages from config + DB counts
    const hostsCfg = require('../../../config/hosts.json');
    const db = require('../../db');
    const hostKeys = Object.keys((hostsCfg && hostsCfg.hosts) || {});
    const hostPages = [];
    try {
      // Fetch counts per host type if hosts table exists
      const hasHostsTable = await (async () => { try { return await db.knex.schema.hasTable('hosts'); } catch (_) { return false; } })();
      const counts = {};
      if (hasHostsTable) {
        for (const k of hostKeys) {
          try {
            const [row] = await db.knex('hosts').where({ host_type: k }).count('* as cnt');
            counts[k] = row && (row.cnt || row.count || Object.values(row)[0]) ? Number(row.cnt || row.count || Object.values(row)[0]) : 0;
          } catch (_) { counts[k] = 0; }
        }
      }
      // Build pages (9 per page to match eggs layout)
      for (let i = 0; i < hostKeys.length; i += eggsPerPage) {
        const fields = hostKeys.slice(i, i + eggsPerPage).map(k => {
          const h = hostsCfg.hosts[k] || {};
          const name = `**${h.display || k}**`;
          const valParts = [];
          if (h.rarity) valParts.push(`Rarity: ${h.rarity}`);
          if (counts[k] !== undefined) valParts.push(`Found: ${counts[k]}`);
          if (h.description) valParts.push(h.description);
          let val = valParts.join('\n');
          if (!val) val = 'No data';
          if (name.length > 256) name = name.slice(0, 253) + '...';
          if (val.length > 1024) val = val.slice(0, 1021) + '...';
          return { name, value: val, inline: true };
        });
        hostPages.push(fields);
      }
    } catch (e) {
      // ignore host page building errors
    }
    const getEmbed = (pageIdx) => new EmbedBuilder()
      .setTitle('📚 The Catalogue')
      .setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d)
      .setFooter({ text: `Page ${pageIdx + 1} of ${pages.length}` })
      .addFields(pages[pageIdx]);
    const row = new ActionRowBuilder().addComponents(
      new SecondaryButtonBuilder().setCustomId('prev').setLabel('Previous').setDisabled(page === 0),
      new SecondaryButtonBuilder().setCustomId('next').setLabel('Next').setDisabled(page === pages.length - 1),
      new SecondaryButtonBuilder().setCustomId('view-eggs').setLabel('Eggs').setDisabled(currentView === 'eggs'),
      new SecondaryButtonBuilder().setCustomId('view-hosts').setLabel('Hosts').setDisabled(currentView === 'hosts')
    );
    await safeReply(interaction, { embeds: [getEmbed(page)], components: [row] }, { loggerName: 'command:encyclopedia' });
    if (pages.length === 1) return;
    const { collector, message: msg } = await createInteractionCollector(interaction, { embeds: [getEmbed(page)], components: [row], time: 120_000, ephemeral: cmd.ephemeral === true, edit: true, collectorOptions: { componentType: 2 } });
    if (!collector) {
      try { const l = require('../../utils/logger').get('command:encyclopedia'); l && l.warn && l.warn('Failed to attach encyclopedia collector'); } catch (le) { try { fallbackLogger.warn('Failed to attach encyclopedia collector', le && (le.stack || le)); } catch (ignored) {} }
      return;
    }
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return safeReply(i, { content: 'Only the command user can change pages.', ephemeral: true }, { loggerName: 'command:encyclopedia' });
      try {
        if (i.customId === 'prev') {
          if (currentView === 'eggs') { if (page > 0) page--; }
          else { if (page > 0) page--; }
        }
        if (i.customId === 'next') {
          if (currentView === 'eggs') { if (page < pages.length - 1) page++; }
          else { if (page < hostPages.length - 1) page++; }
        }
        if (i.customId === 'view-eggs') {
          currentView = 'eggs';
          page = 0;
        }
        if (i.customId === 'view-hosts') {
          currentView = 'hosts';
          page = 0;
        }

        const embedToSend = currentView === 'eggs' ? getEmbed(page) : new EmbedBuilder()
          .setTitle('📚 Hosts Catalogue')
          .setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d)
          .setFooter({ text: `Page ${page + 1} of ${Math.max(1, hostPages.length)}` })
          .addFields(hostPages[page] || []);

        const newRow = new ActionRowBuilder().addComponents(
          new SecondaryButtonBuilder().setCustomId('prev').setLabel('Previous').setDisabled(page === 0),
          new SecondaryButtonBuilder().setCustomId('next').setLabel('Next').setDisabled(currentView === 'eggs' ? page === pages.length - 1 : page === hostPages.length - 1),
          new SecondaryButtonBuilder().setCustomId('view-eggs').setLabel('Eggs').setDisabled(currentView === 'eggs'),
          new SecondaryButtonBuilder().setCustomId('view-hosts').setLabel('Hosts').setDisabled(currentView === 'hosts')
        );

        await i.update({ embeds: [embedToSend], components: [newRow] });
      } catch (err) {
        try { await safeReply(i, { content: 'Error changing view.', ephemeral: true }, { loggerName: 'command:encyclopedia' }); } catch (_) {}
      }
    });
    collector.on('end', async () => {
      try { await safeReply(interaction, { components: [] }, { loggerName: 'command:encyclopedia' }); } catch (e) { try { const l = require('../../utils/logger').get('command:encyclopedia'); l && l.warn && l.warn('Failed clearing components after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging encyclopedia component clear failure', le && (le.stack || le)); } catch (ignored) {} } }
    });
  }
};
