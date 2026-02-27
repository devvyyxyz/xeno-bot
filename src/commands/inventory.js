const {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  SecondaryButtonBuilder
} = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

const { getCommandConfig, commands: commandsConfig } = require('../utils/commandsConfig');
const { DiscordAPIError } = require('discord.js');
const eggTypes = require('../../config/eggTypes.json');
const userModel = require('../models/user');

const cmd = getCommandConfig('inventory') || { name: 'inventory', description: 'Show your egg inventory or another user\'s.' };
const shopConfig = require('../../config/shop.json');
const PAGE_SIZE = 12;

function chunkPages(fields) {
  const pages = [];
  for (let i = 0; i < fields.length; i += PAGE_SIZE) pages.push(fields.slice(i, i + PAGE_SIZE));
  return pages;
}

function makeEmbed(target, type, pageIdx, pages, royalJelly = 0) {
  const embed = new EmbedBuilder().setTitle(`${target.username}'s Inventory`).setColor(cmd.embedColor || 0x00b2ff);
  try {
    const avatarUrl = target && typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null;
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  } catch (e) {}
  const page = pages[pageIdx] || [];
  if (!page || page.length === 0) {
    embed.addFields({ name: 'Inventory empty', value: 'You have no items or eggs in this server.', inline: false });
  } else {
    embed.addFields(page);
  }
  embed.setFooter({ text: `Royal Jelly: ${royalJelly} • ${type === 'eggs' ? 'Eggs' : 'Items'} • Page ${pageIdx + 1} of ${Math.max(1, pages.length)}` });
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
    const baseLogger = require('../utils/logger');
    if (baseLogger && baseLogger.sentry) {
      try { baseLogger.sentry.addBreadcrumb({ message: 'db.getUser.start', category: 'db', data: { userId: target.id, guildId } }); } catch {}
    }
    const user = await userModel.getUserByDiscordId(target.id);
    if (baseLogger && baseLogger.sentry) {
      try { baseLogger.sentry.addBreadcrumb({ message: 'db.getUser.finish', category: 'db', data: { userId: target.id, guildId } }); } catch {}
    }
    const eggs = user?.data?.guilds?.[guildId]?.eggs || {};

    // Build initial view: default to eggs
    const items = user?.data?.guilds?.[guildId]?.items || {};
    const getFieldsForType = (viewType) => {
      const out = [];
      // Add avatar as an item entry on the Items page
      if (viewType === 'items') {
        try {
          const avatarUrl = target && typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null;
          const avatarLabel = avatarUrl ? `[View Avatar](${avatarUrl})` : 'Profile picture';
          out.push({ name: 'Avatar', value: avatarLabel, inline: true });
        } catch (e) {}
      }
      if (viewType === 'eggs') {
        for (const type of eggTypes) {
          const count = eggs[type.id];
          if (count && count > 0) out.push({ name: `${type.emoji} ${type.name}`, value: String(count), inline: true });
        }
      } else {
        for (const [itemId, qty] of Object.entries(items || {})) {
          if (qty && qty > 0) {
            const shopItem = (shopConfig.items || []).find(it => it.id === itemId);
            const label = shopItem ? shopItem.name : itemId;
            out.push({ name: `${label}`, value: String(qty), inline: true });
          }
        }
      }
      return out;
    };

    let currentType = 'eggs';
    let fieldsForType = getFieldsForType(currentType);
    let pages = chunkPages(fieldsForType);
    let page = 0;
    const royalJellyBalance = await userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly');

    const embed = makeEmbed(target, currentType, page, pages, royalJellyBalance);

    const components = [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('inventory-type')
          .setPlaceholder('Type')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Eggs').setValue('eggs').setDefault(true),
            new StringSelectMenuOptionBuilder().setLabel('Items').setValue('items')
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
      const logger = require('../utils/logger').get('command:inventory');
      logger.warn('Embed components rejected, falling back to text payload', { error: err && (err.stack || err) });
      try {
        const content = `**${target.username}'s Inventory**\n` + formatInventory(eggs);
        await interaction.editReply({ content, components });
        return;
      } catch (err2) {
        try { await interaction.editReply({ content: 'Failed to render inventory.' }); } catch {}
        throw err2;
      }
    }

    // Collector to handle select + navigation
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 120_000 });
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Only the command user can interact with this view.', ephemeral: true });
      try {
        if (i.customId === 'inventory-type') {
          currentType = i.values && i.values[0] ? i.values[0] : 'eggs';
          fieldsForType = getFieldsForType(currentType);
          pages = chunkPages(fieldsForType);
          page = 0;
          const bal = await userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly');
          const e = makeEmbed(target, currentType, page, pages, bal);
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setLabel('Previous').setCustomId('inventory-prev').setDisabled(page === 0),
            new SecondaryButtonBuilder().setLabel('Next').setCustomId('inventory-next').setDisabled(pages.length <= 1)
          );
          await i.update({ embeds: [e], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('inventory-type').setPlaceholder('Type').addOptions(new StringSelectMenuOptionBuilder().setLabel('Eggs').setValue('eggs').setDefault(currentType==='eggs'), new StringSelectMenuOptionBuilder().setLabel('Items').setValue('items').setDefault(currentType==='items'))), newNav] });
          return;
        }
        if (i.customId === 'inventory-prev' || i.customId === 'inventory-next') {
          if (i.customId === 'inventory-next' && page < pages.length - 1) page++;
          if (i.customId === 'inventory-prev' && page > 0) page--;
          const bal2 = await userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly');
          const e = makeEmbed(target, currentType, page, pages, bal2);
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setLabel('Previous').setCustomId('inventory-prev').setDisabled(page === 0),
            new SecondaryButtonBuilder().setLabel('Next').setCustomId('inventory-next').setDisabled(page >= pages.length - 1)
          );
          await i.update({ embeds: [e], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('inventory-type').setPlaceholder('Type').addOptions(new StringSelectMenuOptionBuilder().setLabel('Eggs').setValue('eggs').setDefault(currentType==='eggs'), new StringSelectMenuOptionBuilder().setLabel('Items').setValue('items').setDefault(currentType==='items'))), newNav] });
          return;
        }
      } catch (err) {
        try { await i.reply({ content: 'Error handling interaction.', ephemeral: true }); } catch {}
      }
    });
    collector.on('end', async () => { try { await interaction.editReply({ components: [] }); } catch {} });
  },
  // Text-mode handlers removed: use slash commands (`executeInteraction`) instead.
};
