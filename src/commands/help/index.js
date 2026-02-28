const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const { SecondaryButtonBuilder } = require('@discordjs/builders');
const { getCommandConfig, getCommandsObject } = require('../../utils/commandsConfig');
const fallbackLogger = require('../../utils/fallbackLogger');
const createInteractionCollector = require('../../utils/collectorHelper');
const cmd = getCommandConfig('help') || { name: 'help', description: 'Show help for available commands' };

function getCategories() {
  const commandsConfig = getCommandsObject();
  return Object.keys(commandsConfig || {});
}

function getCommandsByCategory(category) {
  const commandsConfig = getCommandsObject();
  if (!commandsConfig) return [];
  if (category === 'All') {
    const out = [];
    for (const k of Object.keys(commandsConfig)) {
      const cat = commandsConfig[k] || {};
      for (const cmdKey of Object.keys(cat)) {
        const entry = cat[cmdKey];
        // hide developer-only or explicitly hidden commands from help
        if (entry && (entry.developerOnly === true || entry.hidden === true)) continue;
        out.push(entry);
      }
    }
    // dedupe by name
    const seen = new Set();
    return out.filter(c => {
      const n = c && c.name ? c.name : JSON.stringify(c);
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }
  const cat = (commandsConfig && commandsConfig[category]) || {};
  return Object.values(cat).filter(c => !(c && (c.developerOnly === true || c.hidden === true)));
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const categories = getCategories();
    // include "All" category at the front
    if (!categories.includes('All')) categories.unshift('All');
    // Default: show first category
    const initialCategory = categories[0];
    const commands = getCommandsByCategory(initialCategory);
    // helper: build an embed for a category, resolving command IDs where available
    async function buildEmbed(cat, cmds) {
      // try to fetch guild commands first, fallback to application commands
      let appCommands = null;
      try {
        if (interaction.guild) {
          appCommands = await interaction.guild.commands.fetch();
        }
      } catch (e) { try { logger && logger.warn && logger.warn('Failed fetching application commands in help command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed to fetch app commands for help', le && (le.stack || le)); } }
      if (!appCommands) {
        try { appCommands = await interaction.client.application.commands.fetch(); } catch (e) { try { logger && logger.warn && logger.warn('Failed fetching app commands for help view', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging app commands fetch failure', le && (le.stack || le)); } }
      }

      const usageHints = {
        eggs: '/eggs list | info [egg_id] | destroy [egg_id]',
        hive: '/hive view | power | upgrade [id] | evolve [id] | release [id]',
        setup: '/setup channel [#channel] | spawn-rate [min max] | egg-limit [number] | avatar [attachment|url]',
        shop: '/shop',
        collect: '/collect',
        hatch: '/hatch [egg_id]',
        trade: '/trade [@user] [item_id]',
        battle: '/battle challenge [@player] | defend | rank',
        fun: '/fun pet [id] | dance | quiz',
        craft: '/craft [item_name]',
        train: '/train [xenomorph_id]'
      };

      const lines = await Promise.all(cmds.map(async c => {
        let id = null;
        try {
          if (appCommands) {
            const found = appCommands.find(ac => ac.name === c.name);
            if (found) id = found.id;
          }
        } catch (e) { try { logger && logger.warn && logger.warn('Failed updating help view state', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging help view update failure', le && (le.stack || le)); } }
        const mention = id ? `</${c.name}:${id}>` : `/${c.name}`;
        const usage = usageHints[c.name] || `/${c.name}`;
        return { mention, description: c.description || '', usage };
      }));

      // build pages of fields (inline) - show up to 12 entries per page
      const PAGE_SIZE = 12;
      const pages = [];
      for (let i = 0; i < lines.length; i += PAGE_SIZE) pages.push(lines.slice(i, i + PAGE_SIZE));
      const pageIdx = 0;
      const pageEntries = pages[pageIdx] || [];

      const embed = new EmbedBuilder()
        .setTitle('📖 Bot Commands')
        .setColor(cmd.embedColor || 0x00b2ff)
        .setFooter({ text: `Category: ${cat} • Page ${pageIdx + 1} of ${Math.max(1, pages.length)}` });

      for (const e of pageEntries) {
        const title = `${e.mention} — ${e.usage}`;
        const value = e.description ? `${e.description}` : '\u200B';
        embed.addFields({ name: title, value, inline: true });
      }
      return { embed, pages };
    }

    const built = await buildEmbed(initialCategory, commands);

    const select = new StringSelectMenuBuilder()
      .setCustomId('help-category')
      .setPlaceholder('Select a command category')
      .addOptions(categories.slice(0, 25).map(cat => ({ label: cat, value: cat })));

    const row = new ActionRowBuilder().addComponents(select);
    const navRow = new ActionRowBuilder().addComponents(
      new SecondaryButtonBuilder().setCustomId('help-prev').setLabel('Previous').setDisabled(true),
      new SecondaryButtonBuilder().setCustomId('help-next').setLabel('Next').setDisabled((built.pages || []).length <= 1)
    );

    await interaction.reply({ embeds: [built.embed], components: [row, navRow], ephemeral: cmd.ephemeral === true });

    const { collector, message: msg } = await createInteractionCollector(interaction, { embeds: [built.embed], components: [row, navRow], time: 120_000, ephemeral: cmd.ephemeral === true, edit: true });
    if (!collector) {
      try { const l = require('../../utils/logger').get('command:help'); l && l.warn && l.warn('Failed to attach help collector'); } catch (le) { try { fallbackLogger.warn('Failed to attach help collector', le && (le.stack || le)); } catch (ignored) {} }
      return;
    }
    let currentCategory = initialCategory;
    let pages = built.pages || [[]];
    let page = 0;

    collector.on('collect', async i => {
      try {
        if (i.customId === 'help-category') {
          const cat = i.values[0];
          currentCategory = cat;
          const cmds = getCommandsByCategory(cat);
          const b = await buildEmbed(cat, cmds);
          pages = b.pages || [[]];
          page = 0;
          const e = b.embed;
          // update nav buttons
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setCustomId('help-prev').setLabel('Previous').setDisabled(page === 0),
            new SecondaryButtonBuilder().setCustomId('help-next').setLabel('Next').setDisabled(page >= pages.length - 1)
          );
          await i.update({ embeds: [e], components: [row, newNav] });
          return;
        }
        if (i.customId === 'help-prev' || i.customId === 'help-next') {
          if (i.customId === 'help-next' && page < pages.length - 1) page++;
          if (i.customId === 'help-prev' && page > 0) page--;
          const pageEntries = pages[page] || [];
          const embed = new EmbedBuilder()
            .setTitle('📖 Bot Commands')
            .setColor(cmd.embedColor || 0x00b2ff)
            .setDescription(currentCategory === 'All' ? 'All commands' : `Category: ${currentCategory}`)
            .setFooter({ text: `Page ${page + 1} of ${Math.max(1, pages.length)}` });
          for (const e of pageEntries) embed.addFields({ name: `${e.mention} — ${e.usage || `/${e.mention}`}`, value: e.description || '\u200B', inline: true });
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setCustomId('help-prev').setLabel('Previous').setDisabled(page === 0),
            new SecondaryButtonBuilder().setCustomId('help-next').setLabel('Next').setDisabled(page >= pages.length - 1)
          );
          await i.update({ embeds: [embed], components: [row, newNav] });
          return;
        }
      } catch (err) {
        try { const safeReply = require('../../utils/safeReply'); await safeReply(i, { content: 'Failed to update help view.', ephemeral: true }, { loggerName: 'command:help' }); } catch (e) { try { logger && logger.warn && logger.warn('Failed to send failure safeReply in help command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging safeReply failure in help', le && (le.stack || le)); } }
      }
    });
    collector.on('end', async () => {
      try { await msg.edit({ components: [] }); } catch (e) { try { logger && logger.warn && logger.warn('Failed clearing help components after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging help component clear failure', le && (le.stack || le)); } catch (ignored) {} } }
    });
  },
  // text-mode handler removed; use slash command
};
