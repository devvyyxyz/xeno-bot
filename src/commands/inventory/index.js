const {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  SecondaryButtonBuilder
} = require('@discordjs/builders');
const {
  SeparatorBuilder,
  SeparatorSpacingSize,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');
const fallbackLogger = require('../../utils/fallbackLogger');
const createInteractionCollector = require('../../utils/collectorHelper');

const { getCommandConfig, commands: commandsConfig } = require('../../utils/commandsConfig');
const { DiscordAPIError } = require('discord.js');
const eggTypes = require('../../../config/eggTypes.json');
const userModel = require('../../models/user');
const hostModel = require('../../models/host');
const xenoModel = require('../../models/xenomorph');

const cmd = getCommandConfig('inventory') || { name: 'inventory', description: 'Show your egg inventory or another user\'s.' };
const shopConfig = require('../../../config/shop.json');
const PAGE_SIZE = 12;

function chunkPages(fields) {
  const pages = [];
  for (let i = 0; i < fields.length; i += PAGE_SIZE) pages.push(fields.slice(i, i + PAGE_SIZE));
  return pages;
}

function makeInventoryComponents(target, type, pageIdx, pages, balances = {}, opts = {}) {
  const {
    showControls = true,
    disablePrev = false,
    disableNext = false
  } = opts;
  const container = new ContainerBuilder();
  const page = pages[pageIdx] || [];
  const typeLabel = type === 'eggs' ? 'Eggs' : type === 'items' ? 'Items' : type === 'hosts' ? 'Hosts' : type === 'xenos' ? 'Xenos' : 'Currencies';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${target.username}'s Inventory`)
  );
  if (!page || page.length === 0) {
    const emptyMessages = {
      eggs: 'You have no eggs in this server.',
      items: 'You have no items in this server.',
      currencies: 'You have no currencies in this server.',
      hosts: 'You have no hosts in this server.',
      xenos: 'You have no xenomorphs in this server.'
    };
    const emptyMsg = emptyMessages[type] || 'You have no items in this server.';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Inventory empty**\n${emptyMsg}`));
  } else {
    const rows = page.map((entry) => `**${entry.name}**: ${entry.value}`).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rows));
  }
  if (showControls) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('inventory-type')
          .setPlaceholder(typeLabel)
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Eggs').setValue('eggs').setDefault(type === 'eggs'),
            new StringSelectMenuOptionBuilder().setLabel('Items').setValue('items').setDefault(type === 'items'),
            new StringSelectMenuOptionBuilder().setLabel('Currencies').setValue('currencies').setDefault(type === 'currencies'),
            new StringSelectMenuOptionBuilder().setLabel('Hosts').setValue('hosts').setDefault(type === 'hosts'),
            new StringSelectMenuOptionBuilder().setLabel('Xenos').setValue('xenos').setDefault(type === 'xenos')
          )
      )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new SecondaryButtonBuilder()
          .setLabel('Previous')
          .setCustomId('inventory-prev')
          .setDisabled(!!disablePrev),
        new SecondaryButtonBuilder()
          .setLabel('Next')
          .setCustomId('inventory-next')
          .setDisabled(!!disableNext)
      )
    );
  }

  const royal = Number(balances.royal_jelly || 0);
  const credits = Number(balances.credits || 0);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`_Royal Jelly: ${royal} • Credits: ${credits} • ${typeLabel} • Page ${pageIdx + 1} of ${Math.max(1, pages.length)}_`)
  );
  return [container];
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

      if (viewType === 'xenos') {
        try {
          const rows = await xenoModel.getXenosByOwner(target.id);
          for (const x of rows) {
            const label = `#${x.id} ${x.role || x.stage}`;
            out.push({ name: label, value: `Pathway: ${x.pathway || 'standard'} • Created: ${new Date(Number(x.created_at || x.started_at || Date.now())).toLocaleString()}`, inline: false });
          }
        } catch (e) {
          // ignore
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

    const messageComponents = makeInventoryComponents(
      target,
      currentType,
      page,
      pages,
      { royal_jelly: royalJellyBalance, credits: creditsBalance },
      { showControls: true, disablePrev: page === 0, disableNext: page >= pages.length - 1 }
    );

    try {
      await interaction.editReply({ components: messageComponents, flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
      const logger = require('../../utils/logger').get('command:inventory');
      logger.warn('Inventory V2 components rejected, using minimal V2 fallback', { error: err && (err.stack || err) });
      try {
        await interaction.editReply({ components: [new TextDisplayBuilder().setContent(`**${target.username}'s Inventory**\n${formatInventory(eggs)}`)], flags: MessageFlags.IsComponentsV2 });
        return;
      } catch (err2) {
        try { await interaction.editReply({ content: 'Failed to render inventory.' }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed to editReply in inventory command', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging editReply error in inventory', le && (le.stack || le)); } catch (ignored) {} } }
        throw err2;
      }
    }

    // Collector to handle select + navigation
    const { collector, message: msg } = await createInteractionCollector(interaction, { components: messageComponents, time: 120_000, ephemeral: cmd.ephemeral === true, edit: true });
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
          const v2Blocks = makeInventoryComponents(
            target,
            currentType,
            page,
            pages,
            { royal_jelly: balRoyal, credits: balCredits },
            { showControls: true, disablePrev: page === 0, disableNext: pages.length <= 1 }
          );
          await i.update({ components: v2Blocks });
          return;
        }
        if (i.customId === 'inventory-prev' || i.customId === 'inventory-next') {
          if (i.customId === 'inventory-next' && page < pages.length - 1) page++;
          if (i.customId === 'inventory-prev' && page > 0) page--;
          const [bal2Royal, bal2Credits] = await Promise.all([
            userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly'),
            userModel.getCurrencyForGuild(String(target.id), guildId, 'credits')
          ]);
          const v2Blocks = makeInventoryComponents(
            target,
            currentType,
            page,
            pages,
            { royal_jelly: bal2Royal, credits: bal2Credits },
            { showControls: true, disablePrev: page === 0, disableNext: page >= pages.length - 1 }
          );
          await i.update({ components: v2Blocks });
          return;
        }
      } catch (err) {
        try { await i.reply({ content: 'Error handling interaction.', ephemeral: true }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed sending interaction error reply in inventory', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging interaction error reply failure in inventory', le && (le.stack || le)); } catch (ignored) {} } }
      }
    });
    collector.on('end', async () => {
      try {
        const [balRoyal, balCredits] = await Promise.all([
          userModel.getCurrencyForGuild(String(target.id), guildId, 'royal_jelly'),
          userModel.getCurrencyForGuild(String(target.id), guildId, 'credits')
        ]);
        const finalBlocks = makeInventoryComponents(
          target,
          currentType,
          page,
          pages,
          { royal_jelly: balRoyal, credits: balCredits },
          { showControls: false }
        );
        await interaction.editReply({ components: finalBlocks, flags: MessageFlags.IsComponentsV2 });
      } catch (e) {
        try { require('../../utils/logger').get('command:inventory').warn('Failed finalizing inventory view after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging inventory finalization error', le && (le.stack || le)); } catch (ignored) {} }
      }
    });
  },
  // Text-mode handlers removed: use slash commands (`executeInteraction`) instead.
};
