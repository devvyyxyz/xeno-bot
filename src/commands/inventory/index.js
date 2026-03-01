const {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  SecondaryButtonBuilder
} = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const fallbackLogger = require('../../utils/fallbackLogger');
const createInteractionCollector = require('../../utils/collectorHelper');

const { getCommandConfig, commands: commandsConfig } = require('../../utils/commandsConfig');
const { DiscordAPIError } = require('discord.js');
const eggTypes = require('../../../config/eggTypes.json');
const userModel = require('../../models/user');
const hostModel = require('../../models/host');

const cmd = getCommandConfig('inventory') || { name: 'inventory', description: 'Show your egg inventory or another user\'s.' };
const shopConfig = require('../../../config/shop.json');
const PAGE_SIZE = 12;

function chunkPages(fields) {
  const pages = [];
  for (let i = 0; i < fields.length; i += PAGE_SIZE) pages.push(fields.slice(i, i + PAGE_SIZE));
  return pages;
}

function makeEmbed(target, type, pageIdx, pages, balances = {}) {
  const embed = new EmbedBuilder().setTitle(`${target.username}'s Inventory`).setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d);
  try {
    const avatarUrl = target && typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null;
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  } catch (e) {
    try { require('../../utils/logger').get('command:inventory').warn('Failed computing avatar URL in inventory makeEmbed', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging inventory avatar URL error', le && (le.stack || le)); } catch (ignored) {} }
  }
  const page = pages[pageIdx] || [];
  if (!page || page.length === 0) {
    embed.addFields({ name: 'Inventory empty', value: 'You have no items or eggs in this server.', inline: false });
  } else {
    embed.addFields(page);
  }
  const royal = Number(balances.royal_jelly || 0);
  const credits = Number(balances.credits || 0);
  embed.setFooter({ text: `Royal Jelly: ${royal} • Credits: ${credits} • ${type === 'eggs' ? 'Eggs' : type === 'items' ? 'Items' : 'Currencies'} • Page ${pageIdx + 1} of ${Math.max(1, pages.length)}` });
  return embed;
}

function formatInventory(eggs) {
  if (!eggs || Object.keys(eggs).length === 0) return 'No eggs collected yet!';
  let out = '';
  for (const type of eggTypes) {
    const count = eggs[type.id];
    if (count && count > 0) {
      out += `${type.emoji} ${type.name} ─ ${count}\n`;
    }
  }
  if (!out) return 'No eggs collected yet!';
  return out;
}

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
        name: 'user',
        description: 'User to view inventory for',
        type: 6, // USER
        required: false
      }
    ]
  },
  async executeInteraction(interaction) {
    await interaction.deferReply({ ephemeral: cmd.ephemeral === true });
    const target = interaction.options?.getUser ? interaction.options.getUser('user') || interaction.user : interaction.user;
    const guildId = interaction.guildId;
    const baseLogger = require('../../utils/logger');
    if (baseLogger && baseLogger.sentry) {
      try { baseLogger.sentry.addBreadcrumb({ message: 'db.getUser.start', category: 'db', data: { userId: target.id, guildId } }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed to add sentry breadcrumb (db.getUser.start) in inventory', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb (db.getUser.start) error', le && (le.stack || le)); } catch (ignored) {} } }
    }
    const user = await userModel.getUserByDiscordId(target.id);
    if (baseLogger && baseLogger.sentry) {
      try { baseLogger.sentry.addBreadcrumb({ message: 'db.getUser.finish', category: 'db', data: { userId: target.id, guildId } }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed to add sentry breadcrumb (db.getUser.finish) in inventory', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging sentry breadcrumb (db.getUser.finish) error', le && (le.stack || le)); } catch (ignored) {} } }
    }
    const eggs = user?.data?.guilds?.[guildId]?.eggs || {};

    // Build initial view: default to eggs
    const items = user?.data?.guilds?.[guildId]?.items || {};
    const currencies = user?.data?.guilds?.[guildId]?.currency || {};
    const getFieldsForType = async (viewType) => {
      const out = [];
      if (viewType === 'eggs') {
        for (const type of eggTypes) {
          const count = eggs[type.id];
          if (count && count > 0) out.push({ name: `${type.emoji} ${type.name}`, value: String(count), inline: true });
        }
        return out;
      }

      if (viewType === 'currencies') {
        out.push({ name: 'Credits', value: String(currencies.credits || 0), inline: true });
        out.push({ name: 'Royal Jelly', value: String(currencies.royal_jelly || 0), inline: true });
        return out;
      }

      if (viewType === 'hosts') {
        try {
          const rows = await hostModel.listHostsByOwner(target.id);
          for (const r of rows) {
            const label = `${r.host_type} [${r.id}]`;
            out.push({ name: label, value: `Found ${new Date(Number(r.found_at || r.created_at)).toLocaleString()}`, inline: false });
          }
        } catch (e) {
          // ignore and return empty
        }
        return out;
      }

      // items view
      const itemEntries = Object.entries(items || {}).filter(([, qty]) => qty > 0);
      if (itemEntries.length === 0) return out; // no items -> keep fields empty so embed shows "Inventory empty"

      // only show avatar when there are items to display
      try {
        const avatarUrl = target && typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null;
        const avatarLabel = avatarUrl ? `[View Avatar](${avatarUrl})` : 'Profile picture';
        out.push({ name: 'Avatar', value: avatarLabel, inline: true });
      } catch (e) {
        try { require('../../utils/logger').get('command:inventory').warn('Failed computing avatar URL in inventory getFieldsForType', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging inventory avatar URL error in getFieldsForType', le && (le.stack || le)); } catch (ignored) {} }
      }

      for (const [itemId, qty] of itemEntries) {
        const shopItem = (shopConfig.items || []).find(it => it.id === itemId);
        const label = shopItem ? shopItem.name : itemId;
        out.push({ name: `${label}`, value: String(qty), inline: true });
      }
      return out;
    };

    let currentType = 'eggs';
    let fieldsForType = await getFieldsForType(currentType);
    let pages = chunkPages(fieldsForType);
    let page = 0;
    const [royalJellyBalance, creditsBalance] = await Promise.all([
      userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly'),
      userModel.getCurrencyForGuild(String(target.id), guildId, 'credits')
    ]);

    const embed = makeEmbed(target, currentType, page, pages, { royal_jelly: royalJellyBalance, credits: creditsBalance });

    const components = [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('inventory-type')
          .setPlaceholder('Type')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Eggs').setValue('eggs').setDefault(true),
            new StringSelectMenuOptionBuilder().setLabel('Items').setValue('items'),
            new StringSelectMenuOptionBuilder().setLabel('Hosts').setValue('hosts')
          )
      ),
      new ActionRowBuilder().addComponents(
        new SecondaryButtonBuilder().setLabel('Previous').setCustomId('inventory-prev'),
        new SecondaryButtonBuilder().setLabel('Next').setCustomId('inventory-next')
      )
    ];

    try {
      await interaction.editReply({ embeds: [embed], components });
    } catch (err) {
      const logger = require('../../utils/logger').get('command:inventory');
      logger.warn('Embed components rejected, falling back to text payload', { error: err && (err.stack || err) });
      try {
        const content = `**${target.username}'s Inventory**\n` + formatInventory(eggs);
        await interaction.editReply({ content, components });
        return;
      } catch (err2) {
        try { await interaction.editReply({ content: 'Failed to render inventory.' }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed to editReply in inventory command', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging editReply error in inventory', le && (le.stack || le)); } catch (ignored) {} } }
        throw err2;
      }
    }

    // Collector to handle select + navigation
    const { collector, message: msg } = await createInteractionCollector(interaction, { embeds: [embed], components, time: 120_000, ephemeral: cmd.ephemeral === true, edit: true });
    if (!collector) {
      try { require('../../utils/logger').get('command:inventory').warn('Failed to attach inventory collector'); } catch (le) { try { fallbackLogger.warn('Failed to attach inventory collector'); } catch (ignored) {} }
      return;
    }
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Only the command user can interact with this view.', ephemeral: true });
      try {
        if (i.customId === 'inventory-type') {
          currentType = i.values && i.values[0] ? i.values[0] : 'eggs';
          fieldsForType = await getFieldsForType(currentType);
          pages = chunkPages(fieldsForType);
          page = 0;
          const [balRoyal, balCredits] = await Promise.all([
            userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly'),
            userModel.getCurrencyForGuild(String(target.id), guildId, 'credits')
          ]);
          const e = makeEmbed(target, currentType, page, pages, { royal_jelly: balRoyal, credits: balCredits });
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setLabel('Previous').setCustomId('inventory-prev').setDisabled(page === 0),
            new SecondaryButtonBuilder().setLabel('Next').setCustomId('inventory-next').setDisabled(pages.length <= 1)
          );
          await i.update({ embeds: [e], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('inventory-type').setPlaceholder('Type').addOptions(new StringSelectMenuOptionBuilder().setLabel('Eggs').setValue('eggs').setDefault(currentType==='eggs'), new StringSelectMenuOptionBuilder().setLabel('Items').setValue('items').setDefault(currentType==='items'), new StringSelectMenuOptionBuilder().setLabel('Currencies').setValue('currencies').setDefault(currentType==='currencies'), new StringSelectMenuOptionBuilder().setLabel('Hosts').setValue('hosts').setDefault(currentType==='hosts'))), newNav] });
          return;
        }
        if (i.customId === 'inventory-prev' || i.customId === 'inventory-next') {
          if (i.customId === 'inventory-next' && page < pages.length - 1) page++;
          if (i.customId === 'inventory-prev' && page > 0) page--;
          const [bal2Royal, bal2Credits] = await Promise.all([
            userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly'),
            userModel.getCurrencyForGuild(String(target.id), guildId, 'credits')
          ]);
          const e = makeEmbed(target, currentType, page, pages, { royal_jelly: bal2Royal, credits: bal2Credits });
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setLabel('Previous').setCustomId('inventory-prev').setDisabled(page === 0),
            new SecondaryButtonBuilder().setLabel('Next').setCustomId('inventory-next').setDisabled(page >= pages.length - 1)
          );
          await i.update({ embeds: [e], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('inventory-type').setPlaceholder('Type').addOptions(new StringSelectMenuOptionBuilder().setLabel('Eggs').setValue('eggs').setDefault(currentType==='eggs'), new StringSelectMenuOptionBuilder().setLabel('Items').setValue('items').setDefault(currentType==='items'), new StringSelectMenuOptionBuilder().setLabel('Currencies').setValue('currencies').setDefault(currentType==='currencies'), new StringSelectMenuOptionBuilder().setLabel('Hosts').setValue('hosts').setDefault(currentType==='hosts'))), newNav] });
          return;
        }
      } catch (err) {
        try { await i.reply({ content: 'Error handling interaction.', ephemeral: true }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed sending interaction error reply in inventory', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging interaction error reply failure in inventory', le && (le.stack || le)); } catch (ignored) {} } }
      }
    });
    collector.on('end', async () => { try { await interaction.editReply({ components: [] }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed clearing components after inventory collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging clearing components error in inventory collector end', le && (le.stack || le)); } catch (ignored) {} } } });
  },
  // Text-mode handlers removed: use slash commands (`executeInteraction`) instead.
};
