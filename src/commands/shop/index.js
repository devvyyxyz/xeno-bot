const { getCommandConfig } = require('../../utils/commandsConfig');
const shopConfig = require('../../../config/shop.json');
const emojiMap = require('../../../config/emojis.json');
const eggTypes = require('../../../config/eggTypes.json');
const { EmbedBuilder, ActionRowBuilder } = require('discord.js');
const { StringSelectMenuBuilder, SecondaryButtonBuilder, SuccessButtonBuilder } = require('@discordjs/builders');
const userModel = require('../../models/user');

const logger = require('../../utils/logger').get('command:shop');
const fallbackLogger = require('../../utils/fallbackLogger');
const createInteractionCollector = require('../../utils/collectorHelper');

const cmd = getCommandConfig('shop') || { name: 'shop', description: 'Open the shop to buy items.' };

const PAGE_SIZE = 6;

function buildPages(items) {
  const pages = [];
  for (let i = 0; i < items.length; i += PAGE_SIZE) pages.push(items.slice(i, i + PAGE_SIZE));
  return pages;
}

function makeEmbedForPage(categoryName, pageIdx, pages, royalJelly = 0) {
  const page = pages[pageIdx] || [];
  const embed = new EmbedBuilder()
    .setTitle(`${categoryName} Shop`)
    .setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d)
    .setFooter({ text: `Royal Jelly: ${royalJelly} • Page ${pageIdx + 1} of ${Math.max(1, pages.length)}` });
  if (page.length === 0) embed.setDescription('No items in this category.');
  for (const it of page) {
    const emoji = it.emoji && emojiMap && emojiMap[it.emoji] ? emojiMap[it.emoji] : '';
    const title = `${emoji ? `${emoji} ` : ''}${it.name} — ${it.price}`;
    embed.addFields({ name: title, value: it.description || '\u200B', inline: true });
  }
  return embed;
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const categories = (shopConfig.categories || []).map(c => ({ id: c.id, name: c.name }));
    if (categories.length === 0) categories.push({ id: 'all', name: 'All' });
    const initialCategory = categories[0].id;

    const getItemsByCategory = (catId) => {
      const items = (shopConfig.items || []).map(it => Object.assign({}, it, { type: 'item' }));
      if (!catId || catId === 'all') return items;
      return items.filter(i => (i.category || 'general') === catId);
    };

    let currentCategory = initialCategory;
    let items = getItemsByCategory(currentCategory);
    let pages = buildPages(items);
    let page = 0;

    const initialBalance = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
    const embed = makeEmbedForPage((shopConfig.categories || []).find(c => c.id === currentCategory)?.name || 'Shop', page, pages, initialBalance);

    const categorySelect = new StringSelectMenuBuilder()
      .setCustomId('shop-category')
      .setPlaceholder('Select category')
      .addOptions(categories.slice(0, 25).map(c => ({ label: c.name, value: c.id })));

    const navRow = new ActionRowBuilder().addComponents(
      new SecondaryButtonBuilder().setCustomId('shop-prev').setLabel('Previous').setDisabled(page === 0),
      new SecondaryButtonBuilder().setCustomId('shop-next').setLabel('Next').setDisabled(pages.length <= 1),
      new SuccessButtonBuilder().setCustomId('shop-buy').setLabel('Buy')
    );

    const components = [new ActionRowBuilder().addComponents(categorySelect), navRow];

    await interaction.editReply({ embeds: [embed], components, ephemeral: cmd.ephemeral === true });

    const { collector, message: msg } = await createInteractionCollector(interaction, { embeds: [embed], components, time: 120_000, ephemeral: cmd.ephemeral === true, edit: true });
    if (!collector) {
      logger.warn('Failed to attach main shop collector');
      return;
    }

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Only the command user can interact with this shop view.', ephemeral: true });
      try {
        if (i.customId === 'shop-category') {
          const cat = i.values && i.values[0];
          currentCategory = cat;
          items = getItemsByCategory(currentCategory);
          pages = buildPages(items);
          page = 0;
          const bal = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
          const e = makeEmbedForPage((shopConfig.categories || []).find(c => c.id === currentCategory)?.name || 'Shop', page, pages, bal);
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setCustomId('shop-prev').setLabel('Previous').setDisabled(page === 0),
            new SecondaryButtonBuilder().setCustomId('shop-next').setLabel('Next').setDisabled(pages.length <= 1),
            new SuccessButtonBuilder().setCustomId('shop-buy').setLabel('Buy')
          );
          await i.update({ embeds: [e], components: [new ActionRowBuilder().addComponents(categorySelect), newNav] });
          return;
        }
        if (i.customId === 'shop-prev' || i.customId === 'shop-next') {
          if (i.customId === 'shop-next' && page < pages.length - 1) page++;
          if (i.customId === 'shop-prev' && page > 0) page--;
          const bal2 = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
          const e = makeEmbedForPage((shopConfig.categories || []).find(c => c.id === currentCategory)?.name || 'Shop', page, pages, bal2);
          const newNav = new ActionRowBuilder().addComponents(
            new SecondaryButtonBuilder().setCustomId('shop-prev').setLabel('Previous').setDisabled(page === 0),
            new SecondaryButtonBuilder().setCustomId('shop-next').setLabel('Next').setDisabled(page >= pages.length - 1),
            new SuccessButtonBuilder().setCustomId('shop-buy').setLabel('Buy')
          );
          await i.update({ embeds: [e], components: [new ActionRowBuilder().addComponents(categorySelect), newNav] });
          return;
        }
        if (i.customId === 'shop-buy') {
          // Show ephemeral select menu for items on current page
          const pageItems = pages[page] || [];
          if (pageItems.length === 0) return i.reply({ content: 'No items to buy on this page.', ephemeral: true });
          const itemSelect = new StringSelectMenuBuilder()
            .setCustomId('shop-buy-select')
            .setPlaceholder('Select item to buy')
            .addOptions(pageItems.slice(0, 25).map(it => {
              const emoji = it.emoji && emojiMap && emojiMap[it.emoji] ? emojiMap[it.emoji] : '';
              const label = `${emoji ? `${emoji} ` : ''}${it.name} — ${it.price ?? '—'}`;
              return { label: label.slice(0, 100), value: `${it.type || 'item'}:${it.id}` };
            }));
          // Use helper to create the ephemeral select and its collector
          const { collector: selCollector, message: replyMsg } = await createInteractionCollector(i, { components: [new ActionRowBuilder().addComponents(itemSelect)], time: 60_000, ephemeral: true, edit: false });
          if (!selCollector) {
            try { await i.reply({ content: 'Failed to open purchase selector.', ephemeral: true }); } catch (e) { logger.warn('Failed to notify user about selector failure', { error: e && (e.stack || e) }); }
            return;
          }
          selCollector.on('collect', async sel => {
            if (sel.user.id !== i.user.id) return sel.reply({ content: 'This selection is for the original buyer only.', ephemeral: true });
            const raw = sel.values && sel.values[0];
            if (!raw) return sel.update({ content: 'No selection made.', components: [], ephemeral: true });
            const [type, itemId] = raw.split(':');
            let item = null;
            if (type === 'egg') item = (eggTypes || []).find(e => e.id === itemId);
            else item = (shopConfig.items || []).find(it => it.id === itemId);
            if (!item) return sel.update({ content: 'Selected item not found.', components: [], ephemeral: true });
            const price = Number(item.price || 0) || null;
            if (!price) return sel.update({ content: `This item cannot be purchased (no price set).`, components: [] , ephemeral: true});
            try {
              const balance = await userModel.getCurrencyForGuild(String(sel.user.id), interaction.guildId, 'royal_jelly');
              if (balance < price) return sel.update({ content: `Insufficient royal_jelly. Need ${price}, you have ${balance}.`, components: [], ephemeral: true });
              // Deduct first, then add; refund on failure.
              const newBal = await userModel.modifyCurrencyForGuild(String(sel.user.id), interaction.guildId, 'royal_jelly', -price);
              try {
                if (type === 'egg') {
                  await userModel.addEggsForGuild(String(sel.user.id), interaction.guildId, 1, itemId);
                } else {
                  await userModel.addItemForGuild(String(sel.user.id), interaction.guildId, itemId, 1);
                }
                await sel.update({ content: `Purchased ${item.name} for ${price} royal_jelly. New balance: ${newBal}.`, components: [] });
              } catch (addErr) {
                // refund
                try { await userModel.modifyCurrencyForGuild(String(sel.user.id), interaction.guildId, 'royal_jelly', +price); } catch (refundErr) {}
                await sel.update({ content: `Failed to add item after purchase: ${addErr && (addErr.message || addErr)}`, components: [] });
              }
            } catch (err) {
              await sel.update({ content: `Failed to process purchase: ${err && (err.message || err)}`, components: [] });
            }
            selCollector.stop();
          });
          selCollector.on('end', async () => {
            try { await i.followUp({ content: 'Purchase session ended.', ephemeral: true }); } catch (e) { try { logger.warn('Failed to followUp after selCollector end in shop', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging followUp failure in shop selCollector end', le && (le.stack || le)); } catch (ignored) {} } }
          });
          return;
        }
      } catch (err) {
        try { await i.reply({ content: 'Error handling shop interaction.', ephemeral: true }); } catch (e) { try { logger.warn('Failed sending error reply in shop interaction handler', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging shop interaction error reply failure', le && (le.stack || le)); } catch (ignored) {} } }
      }
    });
    collector.on('end', async () => { try { await interaction.editReply({ components: [] }); } catch (e) { try { logger.warn('Failed clearing shop components after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging clearing shop components error', le && (le.stack || le)); } catch (ignored) {} } } });
  }
};
