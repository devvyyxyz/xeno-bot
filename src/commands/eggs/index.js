const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const userModel = require('../../models/user');
const hatchManager = require('../../hatchManager');
const eggTypes = require('../../../config/eggTypes.json');
const emojis = require('../../../config/emojis.json');
const rarities = require('../../../config/rarities.json');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const {
  ActionRowBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('@discordjs/builders');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');

const cmd = getCommandConfig('eggs') || { name: 'eggs', description: 'Manage your eggs' };

const HATCHES_PER_PAGE = 4;

function getEggDisplay(eggType) {
  const eggMeta = eggTypes.find(e => e.id === eggType);
  if (!eggMeta) return eggType;
  const emoji = eggMeta.emoji || '';
  const name = eggMeta.name || eggType;
  return emoji ? `${emoji} ${name}` : name;
}

function getRarityBadge(rarity) {
  const numRarity = Number(rarity) || 1;
  const rarityConfig = rarities.find(r => numRarity >= r.minRarity && numRarity <= r.maxRarity);
  if (!rarityConfig) return '';
  const emojiKey = rarityConfig.emoji;
  return emojis[emojiKey] || '';
}

function buildEggsListPage({ pageIdx = 0, hatches = [], client = null }) {
  // Show all hatches (including collected)
  const activeHatches = hatches;
  
  const totalPages = Math.ceil(activeHatches.length / HATCHES_PER_PAGE);
  const safePageIdx = Math.max(0, Math.min(pageIdx, totalPages - 1));
  const start = safePageIdx * HATCHES_PER_PAGE;
  const end = start + HATCHES_PER_PAGE;
  const page = activeHatches.slice(start, end);

  const container = new ContainerBuilder();
  addV2TitleWithBotThumbnail({ container, title: 'Active Hatches', client });

  if (!page || page.length === 0) {
    if (activeHatches.length === 0) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no active hatches.'));
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('No hatches on this page.'));
    }
  } else {
    const now = Date.now();
    for (const hatch of page) {
      const finishes = Number(hatch.finishes_at) || 0;
      const ready = finishes <= now;
      const collected = hatch.collected;
      const eggName = getEggDisplay(hatch.egg_type);
      
      // Get rarity badge
      const eggMeta = eggTypes.find(e => e.id === hatch.egg_type);
      const rarity = eggMeta ? eggMeta.rarity : 1;
      const badge = getRarityBadge(rarity);
      
      let statusLine;
      if (collected) {
        statusLine = 'Collected: ✅';
      } else if (ready) {
        const hatched = Number(hatch.created_at) || 0;
        statusLine = `Hatched: <t:${Math.floor(hatched / 1000)}:R>`;
      } else {
        statusLine = `Hatching: <t:${Math.floor(finishes / 1000)}:R>`;
      }
      
      const section = new SectionBuilder()
        .setSuccessButtonAccessory((button) =>
          button
            .setLabel(collected ? 'Collected' : 'Collect')
            .setCustomId(`eggs-collect-one:${hatch.id}`)
            .setDisabled(!ready || collected)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**${eggName}** • ${badge}\nID: ${hatch.id}\n${statusLine}`)
        );
      container.addSectionComponents(section);
    }
  }

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // Pagination Row
  const navRow = new ActionRowBuilder();
  if (safePageIdx > 0) {
    navRow.addComponents(
      new SecondaryButtonBuilder().setCustomId('eggs-prev-page').setLabel('Prev')
    );
  }
  const pageInfo = totalPages > 1 ? ` (${safePageIdx + 1}/${totalPages})` : '';
  const pageBtn = new SecondaryButtonBuilder()
    .setCustomId('eggs-page-info')
    .setLabel(`Total: ${activeHatches.length}${pageInfo}`)
    .setDisabled(true);
  navRow.addComponents(pageBtn);

  if (safePageIdx < totalPages - 1) {
    navRow.addComponents(
      new SecondaryButtonBuilder().setCustomId('eggs-next-page').setLabel('Next')
    );
  }

  container.addActionRowComponents(navRow);

  // Action Row (Stats, Hatch)
  const actionRow = new ActionRowBuilder()
    .addComponents(
      new PrimaryButtonBuilder().setCustomId('eggs-view-stats').setLabel('Stats'),
      new PrimaryButtonBuilder().setCustomId('eggs-hatch-egg').setLabel('Hatch Egg')
    );
  container.addActionRowComponents(actionRow);

  return [container];
}

function buildEggsResultPage(content = '') {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🥚 Result'));
  if (content) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  }
  
  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );
  
  // View List button
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new PrimaryButtonBuilder().setCustomId('eggs-view-list').setLabel('View List')
    )
  );
  
  return [container];
}

function buildEggsHatchPage({ userEggs = {}, client = null }) {
  const container = new ContainerBuilder();
  addV2TitleWithBotThumbnail({ container, title: 'Hatch an Egg', client });

  // Get eggs user has with quantity > 0
  const availableEggs = Object.entries(userEggs)
    .map(([id, qty]) => ({ id, qty: Number(qty) }))
    .filter(e => e.qty > 0);

  if (availableEggs.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You don\'t have any eggs to hatch. Collect some eggs first!'));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Select an egg to hatch from the dropdown below:'));
    
    // Create select menu with egg options
    const options = availableEggs.slice(0, 25).map(egg => {
      const eggMeta = eggTypes.find(e => e.id === egg.id);
      const name = eggMeta ? eggMeta.name : egg.id;
      const emoji = eggMeta?.emoji;
      const hatchTime = eggMeta ? Number(eggMeta.hatch || 60) : 60;
      const label = `${name} (${egg.qty}) - ${hatchTime}s`;
      
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(egg.id);
      
      if (emoji) {
        try {
          // Try to parse custom emoji <:name:id> or <a:name:id>
          const match = emoji.match(/<a?:([^:]+):(\d+)>/);
          if (match) {
            option.setEmoji({ id: match[2], name: match[1] });
          }
        } catch (e) {
          // Skip emoji if parsing fails
        }
      }
      
      return option;
    });

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('eggs-select-hatch')
          .setPlaceholder('Choose an egg to hatch')
          .addOptions(options)
      )
    );
  }

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // Back button
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new SecondaryButtonBuilder().setCustomId('eggs-back-to-list').setLabel('Back to List')
    )
  );

  return [container];
}

function buildEggsStatsPage({ hatches = [], client = null }) {
  const container = new ContainerBuilder();
  addV2TitleWithBotThumbnail({ container, title: 'Egg Statistics', client });

  const activeHatches = hatches.filter(h => !h.collected);
  const now = Date.now();
  const readyCount = activeHatches.filter(h => (Number(h.finishes_at) || 0) <= now).length;
  const eggTypeCounts = {};
  
  for (const hatch of activeHatches) {
    const eggType = hatch.egg_type;
    eggTypeCounts[eggType] = (eggTypeCounts[eggType] || 0) + 1;
  }

  const mostCommonEgg = Object.entries(eggTypeCounts).sort((a, b) => b[1] - a[1])[0];
  const mostCommonDisplay = mostCommonEgg ? getEggDisplay(mostCommonEgg[0]) : 'None';
  const mostCommonCount = mostCommonEgg ? mostCommonEgg[1] : 0;

  const stats = [
    `**Total Hatches:** ${activeHatches.length}`,
    `**Ready to Collect:** ${readyCount}`,
    `**Most Common:** ${mostCommonDisplay} (×${mostCommonCount})`,
    `**Unique Types:** ${Object.keys(eggTypeCounts).length}`
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(stats.join('\n')));

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder().setCustomId('eggs-back-to-list').setLabel('Back to List')
  );
  container.addActionRowComponents(backRow);

  return [container];
}

function buildEggsView({ screen = 'list', hatches = [], pageIdx = 0, content = '', client = null, userEggs = {} }) {
  if (screen === 'stats') {
    return buildEggsStatsPage({ hatches, client });
  }
  if (screen === 'hatch') {
    return buildEggsHatchPage({ userEggs, client });
  }
  if (screen === 'result') {
    return buildEggsResultPage(content);
  }
  return buildEggsListPage({ pageIdx, hatches, client });
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
    options: buildSubcommandOptions('eggs', [])
  },
  async autocomplete(interaction) {
    try {
      const autocomplete = require('../../utils/autocomplete');
      // detect subcommand for targeted autocomplete
      let sub = null;
      try { sub = interaction.options && interaction.options.getSubcommand ? (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })() : null; } catch (e) { sub = null; }
      const discordId = interaction.user.id;
      const guildId = interaction.guildId;
      const logger = require('../../utils/logger').get('command:eggs');
      const u = await userModel.getUserByDiscordId(discordId);
      let inventoryEggs = [];
      if (u && u.data && u.data.guilds && u.data.guilds[guildId] && u.data.guilds[guildId].eggs) {
        inventoryEggs = Object.entries(u.data.guilds[guildId].eggs).map(([id, qty]) => ({ id, qty: Number(qty) })).filter(e => e.qty > 0);
      }
      // If no eggs in inventory, fall back to listing all egg types (qty 0)
      if (!inventoryEggs || inventoryEggs.length === 0) {
        inventoryEggs = eggTypes.map(e => ({ id: e.id, qty: 0 }));
      }
      const items = inventoryEggs.map(e => {
        const meta = eggTypes.find(t => t.id === e.id);
        return { id: e.id, name: meta ? `${meta.name} (${e.qty})` : `${e.id} (${e.qty})` };
      });
      logger.info('Autocomplete invocation', { discordId, guildId, inventoryCount: inventoryEggs.length, itemsCount: items.length, focused: interaction.options.getFocused?.() || '' });
      return autocomplete(interaction, items, { map: it => ({ name: it.name, value: it.id }), max: 25 });
    } catch (e) {
      const logger = require('../../utils/logger').get('command:eggs');
      logger.warn('Autocomplete failed', { error: e && (e.stack || e) });
      try { await interaction.respond([]); } catch (respErr) { logger.warn('Failed to respond empty autocomplete', { error: respErr && (respErr.stack || respErr) }); }
    }
  },

  async executeInteraction(interaction) {
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const subCfg = sub ? (getCommandConfig(`eggs ${sub}`) || getCommandConfig(`eggs.${sub}`)) : null;
    if (subCfg && subCfg.developerOnly) {
      const cfg = require('../../../config/config.json');
      const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
      if (!ownerId || interaction.user.id !== ownerId) {
        const safeReply = require('../../utils/safeReply');
        await safeReply(interaction, { content: 'Only the bot developer/owner can run this subcommand.', ephemeral: true }, { loggerName: 'command:eggs' });
        return;
      }
    }
    const guildId = interaction.guildId;
    const discordId = interaction.user.id;
    try {
        if (sub === 'list') {
            await interaction.deferReply({ ephemeral: true });
            let rows = await hatchManager.listHatches(discordId, guildId);
            const safeReply = require('../../utils/safeReply');
            
            const activeHatches = rows.filter(h => !h.collected);
            if (!activeHatches || activeHatches.length === 0) {
              await safeReply(interaction, { components: buildEggsView({ screen: 'list', hatches: [], client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
              return;
            }

            await safeReply(
              interaction,
              { components: buildEggsView({ screen: 'list', pageIdx: 0, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true },
              { loggerName: 'command:eggs' }
            );

            let msg = null;
            try { msg = await interaction.fetchReply(); } catch (_) {}
            if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

            let currentPage = 0;
            const logger = require('../../utils/logger').get('command:eggs');

            const collector = msg.createMessageComponentCollector({
              filter: i => i.user.id === discordId,
              time: 300_000
            });

            collector.on('collect', async i => {
              try {
                // Pagination
                if (i.customId === 'eggs-prev-page') {
                  currentPage = Math.max(0, currentPage - 1);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                if (i.customId === 'eggs-next-page') {
                  const activeCount = rows.filter(h => !h.collected).length;
                  const totalPages = Math.ceil(activeCount / HATCHES_PER_PAGE);
                  currentPage = Math.min(totalPages - 1, currentPage + 1);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                // Collect single hatch
                if (i.customId.startsWith('eggs-collect-one:')) {
                  const hatchId = Number(i.customId.split(':')[1]);
                  await hatchManager.collectHatch(discordId, guildId, hatchId);
                  
                  // Mark the hatch as collected in the local array
                  const hatchIndex = rows.findIndex(r => r.id === hatchId);
                  if (hatchIndex !== -1) {
                    rows[hatchIndex].collected = true;
                  }

                  // Update display with the collected hatch shown
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                // View stats
                if (i.customId === 'eggs-view-stats') {
                  await i.update({ components: buildEggsStatsPage({ hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                // Hatch egg - show select menu
                if (i.customId === 'eggs-hatch-egg') {
                  const u = await userModel.getUserByDiscordId(discordId);
                  const userEggs = u?.data?.guilds?.[guildId]?.eggs || {};
                  await i.update({ components: buildEggsView({ screen: 'hatch', userEggs, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                // Handle egg selection from hatch menu
                if (i.customId === 'eggs-select-hatch') {
                  const selectedEggId = i.values[0];
                  const eggConfig = eggTypes.find(e => e.id === selectedEggId);
                  
                  if (!eggConfig) {
                    await i.update({ components: buildEggsView({ screen: 'result', content: 'Unknown egg type.' }), flags: MessageFlags.IsComponentsV2 });
                    return;
                  }

                  try {
                    const u = await userModel.getUserByDiscordId(discordId);
                    const curQty = Number((u?.data?.guilds?.[guildId]?.eggs?.[selectedEggId]) || 0);
                    if (curQty < 1) {
                      await i.update({ components: buildEggsView({ screen: 'result', content: `You don't have any ${eggConfig.name}.` }), flags: MessageFlags.IsComponentsV2 });
                      return;
                    }
                    
                    const hatchSeconds = Number(eggConfig.hatch || 60);
                    const h = await hatchManager.startHatch(discordId, guildId, selectedEggId, hatchSeconds * 1000);
                    
                    // Refresh the list with the new hatch
                    rows = await hatchManager.listHatches(discordId, guildId);
                    await i.update({ components: buildEggsView({ screen: 'result', content: `Started hatching ${eggConfig.name}! Hatch ID: ${h.id}. Will finish in ${hatchSeconds}s.` }), flags: MessageFlags.IsComponentsV2 });
                  } catch (e) {
                    await i.update({ components: buildEggsView({ screen: 'result', content: `Failed to start hatch: ${e.message}` }), flags: MessageFlags.IsComponentsV2 });
                  }
                  return;
                }

                // Back to list or view list
                if (i.customId === 'eggs-back-to-list' || i.customId === 'eggs-view-list') {
                  currentPage = 0;
                  rows = await hatchManager.listHatches(discordId, guildId);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: 0, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
              } catch (e) {
                logger.warn('Error handling eggs button collect', { error: e && (e.stack || e) });
              }
            });

            collector.on('end', () => {
              // No action needed
            });
            return;
          }

      if (sub === 'sell') {
        await interaction.deferReply({ ephemeral: true });
        const eggId = interaction.options.getString('egg');
        const amount = interaction.options.getInteger('amount') || 1;
        const eggConfig = eggTypes.find(e => e.id === eggId);
        const safeReply = require('../../utils/safeReply');
        if (!eggConfig) {
          await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: 'Unknown egg type.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
          return;
        }
        try {
          await userModel.removeEggsForGuild(discordId, guildId, eggId, amount);
          const sellPrice = Math.max(0, eggConfig.sell != null ? Number(eggConfig.sell) : Math.floor(Number(eggConfig.price || 0) / 2));
          const total = sellPrice * Number(amount);
          const newBal = await userModel.modifyCurrencyForGuild(discordId, guildId, 'royal_jelly', total);
          await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: `Sold ${amount} x ${eggConfig.name} for ${formatNumber(total)} royal jelly. New balance: ${formatNumber(newBal)}.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
          
          // Set up collector for "View List" button with full list navigation
          let msg = null;
          try { msg = await interaction.fetchReply(); } catch (_) {}
          if (msg && typeof msg.createMessageComponentCollector === 'function') {
            let rows = [];
            let currentPage = 0;
            const logger = require('../../utils/logger').get('command:eggs');
            const collector = msg.createMessageComponentCollector({
              filter: i => i.user.id === discordId,
              time: 300_000
            });
            collector.on('collect', async i => {
              try {
                if (i.customId === 'eggs-view-list') {
                  rows = await hatchManager.listHatches(discordId, guildId);
                  currentPage = 0;
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: 0, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Pagination
                if (i.customId === 'eggs-prev-page') {
                  currentPage = Math.max(0, currentPage - 1);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                if (i.customId === 'eggs-next-page') {
                  const activeCount = rows.filter(h => !h.collected).length;
                  const totalPages = Math.ceil(activeCount / HATCHES_PER_PAGE);
                  currentPage = Math.min(totalPages - 1, currentPage + 1);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Collect single hatch
                if (i.customId.startsWith('eggs-collect-one:')) {
                  const hatchId = Number(i.customId.split(':')[1]);
                  await hatchManager.collectHatch(discordId, guildId, hatchId);
                  const hatchIndex = rows.findIndex(r => r.id === hatchId);
                  if (hatchIndex !== -1) {
                    rows[hatchIndex].collected = true;
                  }
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // View stats
                if (i.customId === 'eggs-view-stats') {
                  await i.update({ components: buildEggsStatsPage({ hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Hatch egg
                if (i.customId === 'eggs-hatch-egg') {
                  const u = await userModel.getUserByDiscordId(discordId);
                  const userEggs = u?.data?.guilds?.[guildId]?.eggs || {};
                  await i.update({ components: buildEggsView({ screen: 'hatch', userEggs, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Handle egg selection from hatch menu
                if (i.customId === 'eggs-select-hatch') {
                  const selectedEggId = i.values[0];
                  const eggConfig = eggTypes.find(e => e.id === selectedEggId);
                  if (!eggConfig) {
                    await i.update({ components: buildEggsView({ screen: 'result', content: 'Unknown egg type.' }), flags: MessageFlags.IsComponentsV2 });
                    return;
                  }
                  try {
                    const u = await userModel.getUserByDiscordId(discordId);
                    const curQty = Number((u?.data?.guilds?.[guildId]?.eggs?.[selectedEggId]) || 0);
                    if (curQty < 1) {
                      await i.update({ components: buildEggsView({ screen: 'result', content: `You don't have any ${eggConfig.name}.` }), flags: MessageFlags.IsComponentsV2 });
                      return;
                    }
                    const hatchSeconds = Number(eggConfig.hatch || 60);
                    const h = await hatchManager.startHatch(discordId, guildId, selectedEggId, hatchSeconds * 1000);
                    rows = await hatchManager.listHatches(discordId, guildId);
                    await i.update({ components: buildEggsView({ screen: 'result', content: `Started hatching ${eggConfig.name}! Hatch ID: ${h.id}. Will finish in ${hatchSeconds}s.` }), flags: MessageFlags.IsComponentsV2 });
                  } catch (e) {
                    await i.update({ components: buildEggsView({ screen: 'result', content: `Failed to start hatch: ${e.message}` }), flags: MessageFlags.IsComponentsV2 });
                  }
                  return;
                }
                // Back to list
                if (i.customId === 'eggs-back-to-list') {
                  currentPage = 0;
                  rows = await hatchManager.listHatches(discordId, guildId);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: 0, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
              } catch (e) {
                logger.warn('Error in eggs sell collector', { error: e && (e.stack || e) });
              }
            });
          }
        } catch (e) {
          await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: `Failed to sell eggs: ${e.message}` }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
        }
        return;
      }
      if (sub === 'hatch') {
        await interaction.deferReply({ ephemeral: true });
        const eggId = interaction.options.getString('egg');
        const amount = interaction.options.getInteger('amount') || 1;
        const eggConfig = eggTypes.find(e => e.id === eggId);
        const safeReply = require('../../utils/safeReply');
        if (!eggConfig) {
          await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: 'Unknown egg type.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
          return;
        }
        try {
          const u = await userModel.getUserByDiscordId(discordId);
          const curQty = Number((u?.data?.guilds?.[guildId]?.eggs?.[eggId]) || 0);
          if (curQty < amount) {
            await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: `You only have ${curQty} x ${eggConfig.name}.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
            return;
          }
          const hatchSeconds = Number(eggConfig.hatch || 60);
          const created = [];
          for (let i = 0; i < amount; i++) {
            const h = await hatchManager.startHatch(discordId, guildId, eggId, hatchSeconds * 1000);
            created.push(h.id);
          }
          await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: `Started ${created.length} hatch(es) for ${eggConfig.name}. First hatch id: ${created[0]}. Each will finish in ${hatchSeconds}s.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
          
          // Set up collector for "View List" button with full list navigation
          let msg = null;
          try { msg = await interaction.fetchReply(); } catch (_) {}
          if (msg && typeof msg.createMessageComponentCollector === 'function') {
            let rows = [];
            let currentPage = 0;
            const logger = require('../../utils/logger').get('command:eggs');
            const collector = msg.createMessageComponentCollector({
              filter: i => i.user.id === discordId,
              time: 300_000
            });
            collector.on('collect', async i => {
              try {
                if (i.customId === 'eggs-view-list') {
                  rows = await hatchManager.listHatches(discordId, guildId);
                  currentPage = 0;
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: 0, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Pagination
                if (i.customId === 'eggs-prev-page') {
                  currentPage = Math.max(0, currentPage - 1);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                if (i.customId === 'eggs-next-page') {
                  const activeCount = rows.filter(h => !h.collected).length;
                  const totalPages = Math.ceil(activeCount / HATCHES_PER_PAGE);
                  currentPage = Math.min(totalPages - 1, currentPage + 1);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Collect single hatch
                if (i.customId.startsWith('eggs-collect-one:')) {
                  const hatchId = Number(i.customId.split(':')[1]);
                  await hatchManager.collectHatch(discordId, guildId, hatchId);
                  const hatchIndex = rows.findIndex(r => r.id === hatchId);
                  if (hatchIndex !== -1) {
                    rows[hatchIndex].collected = true;
                  }
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: currentPage, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // View stats
                if (i.customId === 'eggs-view-stats') {
                  await i.update({ components: buildEggsStatsPage({ hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Hatch egg
                if (i.customId === 'eggs-hatch-egg') {
                  const u = await userModel.getUserByDiscordId(discordId);
                  const userEggs = u?.data?.guilds?.[guildId]?.eggs || {};
                  await i.update({ components: buildEggsView({ screen: 'hatch', userEggs, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
                // Handle egg selection from hatch menu
                if (i.customId === 'eggs-select-hatch') {
                  const selectedEggId = i.values[0];
                  const eggConfig = eggTypes.find(e => e.id === selectedEggId);
                  if (!eggConfig) {
                    await i.update({ components: buildEggsView({ screen: 'result', content: 'Unknown egg type.' }), flags: MessageFlags.IsComponentsV2 });
                    return;
                  }
                  try {
                    const u = await userModel.getUserByDiscordId(discordId);
                    const curQty = Number((u?.data?.guilds?.[guildId]?.eggs?.[selectedEggId]) || 0);
                    if (curQty < 1) {
                      await i.update({ components: buildEggsView({ screen: 'result', content: `You don't have any ${eggConfig.name}.` }), flags: MessageFlags.IsComponentsV2 });
                      return;
                    }
                    const hatchSeconds = Number(eggConfig.hatch || 60);
                    const h = await hatchManager.startHatch(discordId, guildId, selectedEggId, hatchSeconds * 1000);
                    rows = await hatchManager.listHatches(discordId, guildId);
                    await i.update({ components: buildEggsView({ screen: 'result', content: `Started hatching ${eggConfig.name}! Hatch ID: ${h.id}. Will finish in ${hatchSeconds}s.` }), flags: MessageFlags.IsComponentsV2 });
                  } catch (e) {
                    await i.update({ components: buildEggsView({ screen: 'result', content: `Failed to start hatch: ${e.message}` }), flags: MessageFlags.IsComponentsV2 });
                  }
                  return;
                }
                // Back to list
                if (i.customId === 'eggs-back-to-list') {
                  currentPage = 0;
                  rows = await hatchManager.listHatches(discordId, guildId);
                  await i.update({ components: buildEggsView({ screen: 'list', pageIdx: 0, hatches: rows, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
                  return;
                }
              } catch (e) {
                logger.warn('Error in eggs hatch collector', { error: e && (e.stack || e) });
              }
            });
          }
        } catch (e) {
          await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: `Failed to start hatch: ${e.message}` }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' });
        }
        return;
      }
    } catch (err) {
      const logger = require('../../utils/logger').get('command:eggs');
      logger.error('Unhandled error in eggs command', { error: err && (err.stack || err) });
      try { const safeReply = require('../../utils/safeReply'); await safeReply(interaction, { components: buildEggsView({ screen: 'result', content: `Error: ${err && (err.message || err)}` }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:eggs' }); } catch (replyErr) { logger.warn('Failed to send error reply in eggs command', { error: replyErr && (replyErr.stack || replyErr) }); }
    }
  }
};
