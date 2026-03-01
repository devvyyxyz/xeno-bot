const { getCommandConfig } = require('../../utils/commandsConfig');
const shopConfig = require('../../../config/shop.json');
const emojiMap = require('../../../config/emojis.json');
const eggTypes = require('../../../config/eggTypes.json');
const {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SecondaryButtonBuilder
} = require('@discordjs/builders');
const userModel = require('../../models/user');
const safeReply = require('../../utils/safeReply');
const { buildNoticeV2Payload } = require('../../utils/componentsV2');

const logger = require('../../utils/logger').get('command:shop');
const fallbackLogger = require('../../utils/fallbackLogger');

const cmd = getCommandConfig('shop') || { name: 'shop', description: 'Open the shop to buy items.' };

const PAGE_SIZE = 6;

function buildPages(items) {
  const pages = [];
  for (let i = 0; i < items.length; i += PAGE_SIZE) pages.push(items.slice(i, i + PAGE_SIZE));
  return pages;
}

function resolveEmoji(it) {
  if (!it) return '';
  return it.emoji && emojiMap && emojiMap[it.emoji] ? emojiMap[it.emoji] : '';
}

function makeShopComponents({
  categories,
  currentCategory,
  categoryName,
  pageIdx,
  pages,
  royalJelly = 0,
  expired = false
}) {
  const page = pages[pageIdx] || [];
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${categoryName} Shop`)
  );

  if (!page.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('No items in this category.')
    );
  } else {
    for (const it of page) {
      const emoji = resolveEmoji(it);
      const price = Number(it.price || 0) || 0;
      const line = `**${emoji ? `${emoji} ` : ''}${it.name}** — ${price > 0 ? `${price} royal_jelly` : 'Not purchasable'}`;
      const desc = it.description || 'No description.';
      const text = new TextDisplayBuilder().setContent(`${line}\n${desc}`);

      if (!expired && price > 0) {
        const section = new SectionBuilder()
          .setSuccessButtonAccessory((button) =>
            button
              .setCustomId(`shop-buy:${it.type || 'item'}:${it.id}`)
              .setLabel('Buy')
          )
          .addTextDisplayComponents(text);
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(text);
      }
    }
  }

  if (!expired) {
    const categoryOptions = categories.slice(0, 25).map(c => ({ label: c.name, value: c.id, default: c.id === currentCategory }));

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('shop-category')
          .setPlaceholder('Select category')
          .addOptions(...categoryOptions)
      )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new SecondaryButtonBuilder().setCustomId('shop-prev').setLabel('Previous').setDisabled(pageIdx === 0),
        new SecondaryButtonBuilder().setCustomId('shop-next').setLabel('Next').setDisabled(pageIdx >= pages.length - 1)
      )
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`_Royal Jelly: ${royalJelly} • Page ${pageIdx + 1} of ${Math.max(1, pages.length)}${expired ? ' • Shop view expired' : ''}_`)
  );

  return [container];
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
    if (categories.length === 0) {
      const cats = new Set((shopConfig.items || []).map(i => i.category || 'general'));
      categories.push(...Array.from(cats).map(id => ({ id, name: id === 'all' ? 'All' : id.charAt(0).toUpperCase() + id.slice(1) })));
    }
    if (!categories.some(c => c.id === 'all')) categories.unshift({ id: 'all', name: 'All' });
    const initialCategory = categories[0].id;

    const getItemsByCategory = (catId) => {
      const items = (shopConfig.items || []).map(it => Object.assign({}, it, { type: it.type || 'item' }));
      if (!catId || catId === 'all') return items;
      return items.filter(i => (i.category || 'general') === catId);
    };

    let currentCategory = initialCategory;
    let items = getItemsByCategory(currentCategory);
    let pages = buildPages(items);
    let page = 0;

    const initialBalance = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
    const getCategoryName = (catId) => (categories.find(c => c.id === catId)?.name || 'Shop');

    await safeReply(interaction, {
      components: makeShopComponents({
        categories,
        currentCategory,
        categoryName: getCategoryName(currentCategory),
        pageIdx: page,
        pages,
        royalJelly: initialBalance,
        expired: false
      }),
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    }, { loggerName: 'command:shop' });

    let msg = null;
    try { msg = await interaction.fetchReply(); } catch (_) {}
    if (!msg || typeof msg.createMessageComponentCollector !== 'function') {
      logger.warn('Failed to attach main shop collector');
      return;
    }

    const collector = msg.createMessageComponentCollector({
      filter: i => i && (i.customId === 'shop-category' || i.customId === 'shop-prev' || i.customId === 'shop-next' || String(i.customId || '').startsWith('shop-buy:')),
      time: 120_000
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return safeReply(i, { content: 'Only the command user can interact with this shop view.', ephemeral: true }, { loggerName: 'command:shop' });
      try {
        if (i.customId === 'shop-category') {
          const cat = i.values && i.values[0];
          currentCategory = cat;
          items = getItemsByCategory(currentCategory);
          pages = buildPages(items);
          page = 0;
          const bal = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
          await i.update({
            components: makeShopComponents({
              categories,
              currentCategory,
              categoryName: getCategoryName(currentCategory),
              pageIdx: page,
              pages,
              royalJelly: bal,
              expired: false
            })
          });
          return;
        }
        if (i.customId === 'shop-prev' || i.customId === 'shop-next') {
          if (i.customId === 'shop-next' && page < pages.length - 1) page++;
          if (i.customId === 'shop-prev' && page > 0) page--;
          const bal2 = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
          await i.update({
            components: makeShopComponents({
              categories,
              currentCategory,
              categoryName: getCategoryName(currentCategory),
              pageIdx: page,
              pages,
              royalJelly: bal2,
              expired: false
            })
          });
          return;
        }

        if (String(i.customId || '').startsWith('shop-buy:')) {
          const raw = String(i.customId || '');
          const [, type, itemId] = raw.split(':');
          let item = null;
          if (type === 'egg') item = (eggTypes || []).find(e => e.id === itemId);
          else item = (shopConfig.items || []).find(it => it.id === itemId);
          if (!item) {
            await safeReply(i, { content: 'Selected item not found.', ephemeral: true }, { loggerName: 'command:shop' });
            return;
          }
          const price = Number(item.price || 0) || 0;
          if (price <= 0) {
            await safeReply(i, { content: 'This item cannot be purchased (no price set).', ephemeral: true }, { loggerName: 'command:shop' });
            return;
          }

          try {
            const balance = await userModel.getCurrencyForGuild(String(i.user.id), interaction.guildId, 'royal_jelly');
            if (balance < price) {
              await safeReply(i, {
                ...buildNoticeV2Payload({
                  message: `Insufficient royal_jelly. Need ${price}, you have ${balance}.`,
                  tone: 'error'
                }),
                ephemeral: true
              }, { loggerName: 'command:shop' });
              return;
            }

            const newBal = await userModel.modifyCurrencyForGuild(String(i.user.id), interaction.guildId, 'royal_jelly', -price);
            try {
              if (type === 'egg') {
                await userModel.addEggsForGuild(String(i.user.id), interaction.guildId, 1, itemId);
              } else {
                await userModel.addItemForGuild(String(i.user.id), interaction.guildId, itemId, 1);
              }
            } catch (addErr) {
              try { await userModel.modifyCurrencyForGuild(String(i.user.id), interaction.guildId, 'royal_jelly', +price); } catch (_) {}
              await safeReply(i, { content: `Failed to add item after purchase: ${addErr && (addErr.message || addErr)}`, ephemeral: true }, { loggerName: 'command:shop' });
              return;
            }

            // refresh balance and update main shop view in-place
            const refreshedBal = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
            await i.update({
              components: makeShopComponents({
                categories,
                currentCategory,
                categoryName: getCategoryName(currentCategory),
                pageIdx: page,
                pages,
                royalJelly: refreshedBal,
                expired: false
              })
            });

            try {
              await i.followUp({ content: `Purchased ${item.name} for ${price} royal_jelly. New balance: ${newBal}.`, ephemeral: true });
            } catch (_) {}
          } catch (err) {
            await safeReply(i, { content: `Failed to process purchase: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:shop' });
          }
          return;
        }
      } catch (err) {
        try { await safeReply(i, { content: 'Error handling shop interaction.', ephemeral: true }, { loggerName: 'command:shop' }); } catch (e) { try { logger.warn('Failed sending error reply in shop interaction handler', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging shop interaction error reply failure', le && (le.stack || le)); } catch (ignored) {} } }
      }
    });

    collector.on('end', async () => {
      try {
        const bal = await userModel.getCurrencyForGuild(String(interaction.user.id), interaction.guildId, 'royal_jelly');
        await safeReply(interaction, {
          components: makeShopComponents({
            categories,
            currentCategory,
            categoryName: getCategoryName(currentCategory),
            pageIdx: page,
            pages,
            royalJelly: bal,
            expired: true
          }),
          flags: MessageFlags.IsComponentsV2,
          ephemeral: true
        }, { loggerName: 'command:shop' });
      } catch (e) {
        try { logger.warn('Failed finalizing shop components after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging finalizing shop components error', le && (le.stack || le)); } catch (ignored) {} }
      }
    });
  }
};
