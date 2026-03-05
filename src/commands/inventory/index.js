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
const hostsCfg = require('../../../config/hosts.json');
const evolutionsCfg = require('../../../config/evolutions.json');
const emojisCfg = require('../../../config/emojis.json');
const userModel = require('../../models/user');
const hostModel = require('../../models/host');
const xenoModel = require('../../models/xenomorph');
const safeReply = require('../../utils/safeReply');
const { formatNumber } = require('../../utils/numberFormat');

const cmd = getCommandConfig('inventory') || { name: 'inventory', description: 'Show your egg inventory or another user\'s.' };
const shopConfig = require('../../../config/shop.json');
const PAGE_SIZE = 12;

function getHostDisplay(hostType, cfgHosts, emojis) {
  const hostInfo = cfgHosts[hostType] || {};
  const display = hostInfo.display || hostType;
  const emojiKey = hostInfo.emoji;
  const emoji = emojiKey && emojis[emojiKey] ? emojis[emojiKey] : '';
  return emoji ? `${emoji} ${display}` : display;
}

function getXenoDisplay(roleOrStage, evolutions, emojis) {
  const key = String(roleOrStage || '').toLowerCase();
  const roleInfo = evolutions?.roles?.[key] || {};
  const display = roleInfo.display || roleOrStage || 'xenomorph';
  const emojiKey = roleInfo.emoji;
  const emoji = emojiKey && emojis[emojiKey] ? emojis[emojiKey] : '';
  return emoji ? `${emoji} ${display}` : display;
}

function chunkPages(fields) {
  const pages = [];
  for (let i = 0; i < fields.length; i += PAGE_SIZE) pages.push(fields.slice(i, i + PAGE_SIZE));
  return pages;
}

function makeInventoryComponents(target, type, pageIdx, pages, balances = {}, opts = {}) {
  const {
    showControls = true,
    disablePrev = false,
    disableNext = false,
    currentSort = 'date_desc',
    currentFilter = 'all',
    availableFilters = []
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

    // Add sort menu for all types except currencies
    if (type === 'eggs') {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('inventory-sort')
            .setPlaceholder('Sort by')
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel('Name (A-Z)').setValue('name_asc').setDefault(currentSort === 'name_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Name (Z-A)').setValue('name_desc').setDefault(currentSort === 'name_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Quantity (High to Low)').setValue('quantity_desc').setDefault(currentSort === 'quantity_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Quantity (Low to High)').setValue('quantity_asc').setDefault(currentSort === 'quantity_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Rarity (High to Low)').setValue('rarity_desc').setDefault(currentSort === 'rarity_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Rarity (Low to High)').setValue('rarity_asc').setDefault(currentSort === 'rarity_asc')
            )
        )
      );
    } else if (type === 'items') {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('inventory-sort')
            .setPlaceholder('Sort by')
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel('Name (A-Z)').setValue('name_asc').setDefault(currentSort === 'name_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Name (Z-A)').setValue('name_desc').setDefault(currentSort === 'name_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Quantity (High to Low)').setValue('quantity_desc').setDefault(currentSort === 'quantity_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Quantity (Low to High)').setValue('quantity_asc').setDefault(currentSort === 'quantity_asc')
            )
        )
      );
    } else if (type === 'hosts') {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('inventory-sort')
            .setPlaceholder('Sort by')
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel('Newest First').setValue('date_desc').setDefault(currentSort === 'date_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Oldest First').setValue('date_asc').setDefault(currentSort === 'date_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Type (A-Z)').setValue('type_asc').setDefault(currentSort === 'type_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Type (Z-A)').setValue('type_desc').setDefault(currentSort === 'type_desc'),
              new StringSelectMenuOptionBuilder().setLabel('ID (Low to High)').setValue('id_asc').setDefault(currentSort === 'id_asc'),
              new StringSelectMenuOptionBuilder().setLabel('ID (High to Low)').setValue('id_desc').setDefault(currentSort === 'id_desc')
            )
        )
      );
      
      // Add filter menu for host types
      if (availableFilters.length > 0) {
        const filterOptions = [
          new StringSelectMenuOptionBuilder().setLabel('All Types').setValue('all').setDefault(currentFilter === 'all')
        ];
        for (const filter of availableFilters) {
          filterOptions.push(
            new StringSelectMenuOptionBuilder()
              .setLabel(filter.label)
              .setValue(filter.value)
              .setDefault(currentFilter === filter.value)
          );
        }
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('inventory-filter')
              .setPlaceholder('Filter by type')
              .addOptions(...filterOptions)
          )
        );
      }
    } else if (type === 'xenos') {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('inventory-sort')
            .setPlaceholder('Sort by')
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel('Newest First').setValue('date_desc').setDefault(currentSort === 'date_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Oldest First').setValue('date_asc').setDefault(currentSort === 'date_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Stage (A-Z)').setValue('stage_asc').setDefault(currentSort === 'stage_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Stage (Z-A)').setValue('stage_desc').setDefault(currentSort === 'stage_desc'),
              new StringSelectMenuOptionBuilder().setLabel('Pathway (A-Z)').setValue('pathway_asc').setDefault(currentSort === 'pathway_asc'),
              new StringSelectMenuOptionBuilder().setLabel('Pathway (Z-A)').setValue('pathway_desc').setDefault(currentSort === 'pathway_desc'),
              new StringSelectMenuOptionBuilder().setLabel('ID (Low to High)').setValue('id_asc').setDefault(currentSort === 'id_asc'),
              new StringSelectMenuOptionBuilder().setLabel('ID (High to Low)').setValue('id_desc').setDefault(currentSort === 'id_desc')
            )
        )
      );
      
      // Add filter menu for xeno stages
      if (availableFilters.length > 0) {
        const filterOptions = [
          new StringSelectMenuOptionBuilder().setLabel('All Stages').setValue('all').setDefault(currentFilter === 'all')
        ];
        for (const filter of availableFilters) {
          filterOptions.push(
            new StringSelectMenuOptionBuilder()
              .setLabel(filter.label)
              .setValue(filter.value)
              .setDefault(currentFilter === filter.value)
          );
        }
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('inventory-filter')
              .setPlaceholder('Filter by stage')
              .addOptions(...filterOptions)
          )
        );
      }
    }

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
    new TextDisplayBuilder().setContent(`_Royal Jelly: ${formatNumber(royal)} • Credits: ${formatNumber(credits)} • ${typeLabel} • Page ${pageIdx + 1} of ${Math.max(1, pages.length)}_`)
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
    const getFieldsForType = async (viewType, sortBy = 'name_asc', filterBy = 'all') => {
      const out = [];
      const filters = [];
      
      if (viewType === 'eggs') {
        const eggList = [];
        for (const type of eggTypes) {
          const count = eggs[type.id];
          if (count && count > 0) {
            eggList.push({ 
              name: `${type.emoji} ${type.name}`, 
              value: String(count), 
              inline: true,
              type: type,
              count: count
            });
          }
        }
        
        // Apply sorting
        if (sortBy === 'name_asc') {
          eggList.sort((a, b) => a.type.name.localeCompare(b.type.name));
        } else if (sortBy === 'name_desc') {
          eggList.sort((a, b) => b.type.name.localeCompare(a.type.name));
        } else if (sortBy === 'quantity_desc') {
          eggList.sort((a, b) => b.count - a.count);
        } else if (sortBy === 'quantity_asc') {
          eggList.sort((a, b) => a.count - b.count);
        } else if (sortBy === 'rarity_desc') {
          eggList.sort((a, b) => (b.type.rarity || 0) - (a.type.rarity || 0));
        } else if (sortBy === 'rarity_asc') {
          eggList.sort((a, b) => (a.type.rarity || 0) - (b.type.rarity || 0));
        }
        
        return { 
          fields: eggList.map(e => ({ name: e.name, value: e.value, inline: e.inline })),
          filters: []
        };
      }

      if (viewType === 'currencies') {
        out.push({ name: 'Credits', value: String(currencies.credits || 0), inline: true });
        out.push({ name: 'Royal Jelly', value: String(currencies.royal_jelly || 0), inline: true });
        return { fields: out, filters: [] };
      }

      if (viewType === 'hosts') {
        try {
          let rows = await hostModel.listHostsByOwner(target.id);
          
          // Get unique host types for filter options
          const uniqueTypes = new Set();
          for (const r of rows) {
            if (r.host_type) uniqueTypes.add(r.host_type);
          }
          for (const hostType of uniqueTypes) {
            const hostInfo = hostsCfg.hosts?.[hostType];
            const display = hostInfo?.display || hostType;
            filters.push({ label: display, value: hostType });
          }
          filters.sort((a, b) => a.label.localeCompare(b.label));
          
          // Apply filter
          if (filterBy !== 'all') {
            rows = rows.filter(r => r.host_type === filterBy);
          }
          
          // Apply sorting
          if (sortBy === 'date_desc') {
            rows.sort((a, b) => Number(b.found_at || b.created_at) - Number(a.found_at || a.created_at));
          } else if (sortBy === 'date_asc') {
            rows.sort((a, b) => Number(a.found_at || a.created_at) - Number(b.found_at || b.created_at));
          } else if (sortBy === 'type_asc') {
            rows.sort((a, b) => (a.host_type || '').localeCompare(b.host_type || ''));
          } else if (sortBy === 'type_desc') {
            rows.sort((a, b) => (b.host_type || '').localeCompare(a.host_type || ''));
          } else if (sortBy === 'id_asc') {
            rows.sort((a, b) => Number(a.id) - Number(b.id));
          } else if (sortBy === 'id_desc') {
            rows.sort((a, b) => Number(b.id) - Number(a.id));
          }
          
          for (const r of rows) {
            const label = `${getHostDisplay(r.host_type, hostsCfg.hosts || {}, emojisCfg)} [${r.id}]`;
            out.push({ name: label, value: `Found <t:${Math.floor(Number(r.found_at || r.created_at) / 1000)}:f>`, inline: false });
          }
        } catch (e) {
          // ignore and return empty
        }
        return { fields: out, filters };
      }

      if (viewType === 'xenos') {
        try {
          let rows = await xenoModel.getXenosByOwner(target.id);
          
          // Get unique stages for filter options
          const uniqueStages = new Set();
          for (const x of rows) {
            const stage = x.role || x.stage;
            if (stage) uniqueStages.add(stage);
          }
          for (const stage of uniqueStages) {
            filters.push({ label: stage, value: stage });
          }
          filters.sort((a, b) => a.label.localeCompare(b.label));
          
          // Apply filter
          if (filterBy !== 'all') {
            rows = rows.filter(x => (x.role || x.stage) === filterBy);
          }
          
          // Apply sorting
          if (sortBy === 'date_desc') {
            rows.sort((a, b) => Number(b.created_at || b.started_at || 0) - Number(a.created_at || a.started_at || 0));
          } else if (sortBy === 'date_asc') {
            rows.sort((a, b) => Number(a.created_at || a.started_at || 0) - Number(b.created_at || b.started_at || 0));
          } else if (sortBy === 'stage_asc') {
            rows.sort((a, b) => (a.role || a.stage || '').localeCompare(b.role || b.stage || ''));
          } else if (sortBy === 'stage_desc') {
            rows.sort((a, b) => (b.role || b.stage || '').localeCompare(a.role || a.stage || ''));
          } else if (sortBy === 'pathway_asc') {
            rows.sort((a, b) => (a.pathway || 'standard').localeCompare(b.pathway || 'standard'));
          } else if (sortBy === 'pathway_desc') {
            rows.sort((a, b) => (b.pathway || 'standard').localeCompare(a.pathway || 'standard'));
          } else if (sortBy === 'id_asc') {
            rows.sort((a, b) => Number(a.id) - Number(b.id));
          } else if (sortBy === 'id_desc') {
            rows.sort((a, b) => Number(b.id) - Number(a.id));
          }
          
          for (const x of rows) {
            const roleOrStage = x.role || x.stage;
            const label = `${getXenoDisplay(roleOrStage, evolutionsCfg, emojisCfg)} [${x.id}]`;
            out.push({ name: label, value: `Pathway: ${x.pathway || 'standard'} • Created <t:${Math.floor(Number(x.created_at || x.started_at || Date.now()) / 1000)}:f>`, inline: false });
          }
        } catch (e) {
          // ignore
        }
        return { fields: out, filters };
      }

      // items view
      const itemEntries = Object.entries(items || {}).filter(([, qty]) => qty > 0);
      if (itemEntries.length === 0) return { fields: out, filters: [] }; // no items -> keep fields empty so embed shows "Inventory empty"

      // Build item list with metadata for sorting
      const itemList = [];
      for (const [itemId, qty] of itemEntries) {
        const shopItem = (shopConfig.items || []).find(it => it.id === itemId);
        const label = shopItem ? shopItem.name : itemId;
        itemList.push({ 
          name: label, 
          value: String(qty), 
          inline: true,
          quantity: qty
        });
      }
      
      // Apply sorting
      if (sortBy === 'name_asc') {
        itemList.sort((a, b) => a.name.localeCompare(b.name));
      } else if (sortBy === 'name_desc') {
        itemList.sort((a, b) => b.name.localeCompare(a.name));
      } else if (sortBy === 'quantity_desc') {
        itemList.sort((a, b) => b.quantity - a.quantity);
      } else if (sortBy === 'quantity_asc') {
        itemList.sort((a, b) => a.quantity - b.quantity);
      }

      // only show avatar when there are items to display
      try {
        const avatarUrl = target && typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ size: 512, extension: 'png' }) : null;
        const avatarLabel = avatarUrl ? `[View Avatar](${avatarUrl})` : 'Profile picture';
        out.push({ name: 'Avatar', value: avatarLabel, inline: true });
      } catch (e) {
        try { require('../../utils/logger').get('command:inventory').warn('Failed computing avatar URL in inventory getFieldsForType', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging inventory avatar URL error in getFieldsForType', le && (le.stack || le)); } catch (ignored) {} }
      }

      for (const item of itemList) {
        out.push({ name: item.name, value: item.value, inline: item.inline });
      }
      return { fields: out, filters: [] };
    };

    let currentType = 'eggs';
    let currentSort = 'name_asc'; // Default sort for eggs
    let currentFilter = 'all';
    let result = await getFieldsForType(currentType, currentSort, currentFilter);
    let fieldsForType = result.fields;
    let availableFilters = result.filters;
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
      { showControls: true, disablePrev: page === 0, disableNext: page >= pages.length - 1, currentSort, currentFilter, availableFilters }
    );

    try {
      await safeReply(interaction, { components: messageComponents, flags: MessageFlags.IsComponentsV2 }, { loggerName: 'command:inventory' });
    } catch (err) {
      const logger = require('../../utils/logger').get('command:inventory');
      logger.warn('Inventory V2 components rejected, using minimal V2 fallback', { error: err && (err.stack || err) });
      try {
        await safeReply(interaction, { components: [new TextDisplayBuilder().setContent(`**${target.username}'s Inventory**\n${formatInventory(eggs)}`)], flags: MessageFlags.IsComponentsV2 }, { loggerName: 'command:inventory' });
        return;
      } catch (err2) {
        try { await safeReply(interaction, { content: 'Failed to render inventory.' }, { loggerName: 'command:inventory' }); } catch (e) { try { require('../../utils/logger').get('command:inventory').warn('Failed to editReply in inventory command', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging editReply error in inventory', le && (le.stack || le)); } catch (ignored) {} } }
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
      if (i.user.id !== interaction.user.id) {
        return safeReply(i, { content: 'Only the command user can interact with this view.', ephemeral: true }, { loggerName: 'command:inventory' });
      }
      try {
        if (i.customId === 'inventory-type') {
          currentType = i.values && i.values[0] ? i.values[0] : 'eggs';
          // Set appropriate default sort and filter for each type
          if (currentType === 'eggs' || currentType === 'items') {
            currentSort = 'name_asc';
          } else if (currentType === 'hosts' || currentType === 'xenos') {
            currentSort = 'date_desc';
          } else {
            currentSort = 'name_asc'; // fallback
          }
          currentFilter = 'all'; // Reset filter when changing type
          result = await getFieldsForType(currentType, currentSort, currentFilter);
          fieldsForType = result.fields;
          availableFilters = result.filters;
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
            { showControls: true, disablePrev: page === 0, disableNext: pages.length <= 1, currentSort, currentFilter, availableFilters }
          );
          await i.update({ components: v2Blocks });
          return;
        }
        if (i.customId === 'inventory-sort') {
          currentSort = i.values && i.values[0] ? i.values[0] : 'date_desc';
          result = await getFieldsForType(currentType, currentSort, currentFilter);
          fieldsForType = result.fields;
          availableFilters = result.filters;
          pages = chunkPages(fieldsForType);
          page = 0; // Reset to first page after sorting
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
            { showControls: true, disablePrev: page === 0, disableNext: pages.length <= 1, currentSort, currentFilter, availableFilters }
          );
          await i.update({ components: v2Blocks });
          return;
        }
        if (i.customId === 'inventory-filter') {
          currentFilter = i.values && i.values[0] ? i.values[0] : 'all';
          result = await getFieldsForType(currentType, currentSort, currentFilter);
          fieldsForType = result.fields;
          availableFilters = result.filters;
          pages = chunkPages(fieldsForType);
          page = 0; // Reset to first page after filtering
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
            { showControls: true, disablePrev: page === 0, disableNext: pages.length <= 1, currentSort, currentFilter, availableFilters }
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
            { showControls: true, disablePrev: page === 0, disableNext: page >= pages.length - 1, currentSort, currentFilter, availableFilters }
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
          { showControls: false, currentSort, currentFilter, availableFilters }
        );
        await safeReply(interaction, { components: finalBlocks, flags: MessageFlags.IsComponentsV2 }, { loggerName: 'command:inventory' });
      } catch (e) {
        try { require('../../utils/logger').get('command:inventory').warn('Failed finalizing inventory view after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging inventory finalization error', le && (le.stack || le)); } catch (ignored) {} }
      }
    });
  },
  // Text-mode handlers removed: use slash commands (`executeInteraction`) instead.
};
