const {
  ChatInputCommandBuilder,
  ActionRowBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder,
} = require('@discordjs/builders');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const hostModel = require('../../models/host');
const userModel = require('../../models/user');
const hiveModel = require('../../models/hive');
const xenomorphModel = require('../../models/xenomorph');
const db = require('../../db');
const { getCommandConfig } = require('../../utils/commandsConfig');
const hostsCfg = require('../../../config/hosts.json');
const emojisCfg = require('../../../config/emojis.json');
const huntFlavorsCfg = require('../../../config/huntFlavors.json');
const { addV2TitleWithBotThumbnail, addV2TitleWithImageThumbnail } = require('../../utils/componentsV2');
const safeReply = require('../../utils/safeReply');
const logger = require('../../utils/logger').get('command:hunt');

const HOSTS_PER_PAGE = 10;

function isValidEmoji(emoji) {
  if (!emoji || typeof emoji !== 'string') return false;
  // Match discord custom emoji format <:name:id> or <a:name:id> for animated
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(emoji)) return true;
  // Match unicode emoji (basic check - any non-ASCII character)
  if (/[\p{Emoji}]/u.test(emoji)) return true;
  return false;
}

function getHostDisplay(hostType, cfgHosts, emojis) {
  const hostInfo = cfgHosts[hostType] || {};
  const display = hostInfo.display || hostType;
  const emojiKey = hostInfo.emoji;
  const emoji = emojiKey && emojis[emojiKey] ? emojis[emojiKey] : '';
  return emoji ? `${emoji} ${display}` : display;
}

function getRarityBadge(rarity) {
  const badges = {
    'common': '⬜ Common',
    'rare': '🟦 Rare',
    'very_rare': '🟪 Very Rare'
  };
  return badges[rarity] || rarity;
}

function getRandomFlavor(hostType, flavors) {
  const hostFlavors = flavors.hosts[hostType];
  if (!hostFlavors || !Array.isArray(hostFlavors.flavors) || hostFlavors.flavors.length === 0) {
    return flavors.locations[Math.floor(Math.random() * flavors.locations.length)];
  }
  return hostFlavors.flavors[Math.floor(Math.random() * hostFlavors.flavors.length)];
}

function getHostEmojiUrl(hostType, cfgHosts = {}, emojis = {}) {
  const hostInfo = cfgHosts[hostType] || {};
  const emojiKey = hostInfo.emoji;
  const emoji = emojiKey && emojis[emojiKey] ? emojis[emojiKey] : '';
  
  if (!emoji) return null;
  
  // Parse custom emoji format <:name:id> or <a:name:id>
  const emojiMatch = emoji.match(/<a?:(\w+):(\d+)>/);
  if (emojiMatch) {
    const isAnimated = emoji.startsWith('<a:');
    const emojiId = emojiMatch[2];
    return `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}?size=256`;
  }
  
  return null;
}

function buildHostListPage({ pageIdx = 0, rows = [], expired = false, cfgHosts = {}, emojis = {}, client = null }) {
  const totalPages = Math.ceil(rows.length / HOSTS_PER_PAGE);
  const safePageIdx = Math.max(0, Math.min(pageIdx, totalPages - 1));
  const start = safePageIdx * HOSTS_PER_PAGE;
  const end = start + HOSTS_PER_PAGE;
  const page = rows.slice(start, end);

  const container = new ContainerBuilder();

  // Use first host's emoji if available, otherwise fallback to bot avatar
  let hostEmojiUrl = null;
  if (rows.length > 0) {
    hostEmojiUrl = getHostEmojiUrl(rows[0].host_type, cfgHosts, emojis);
  }
  
  if (hostEmojiUrl) {
    addV2TitleWithImageThumbnail({ container, title: 'Host Collection', imageUrl: hostEmojiUrl });
  } else {
    addV2TitleWithBotThumbnail({ container, title: 'Host Collection', client });
  }

  if (page.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no hunted hosts. Use `/hunt go` to search.'));
  } else {
    // Add each host as a section with delete button accessory
    for (const host of page) {
      const info = cfgHosts[host.host_type] || {};
      const display = getHostDisplay(host.host_type, cfgHosts, emojis);
      const rarity = getRarityBadge(info.rarity || 'common');
      
      const section = new SectionBuilder()
        .setSuccessButtonAccessory((button) =>
          button
            .setLabel('Delete')
            .setCustomId(`hunt-delete-one:${host.id}`)
            .setDisabled(expired)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**#${host.id}** — ${display} — ${rarity}`)
        );
      
      container.addSectionComponents(section);
    }
  }

  if (!expired && page.length > 0) {
    // Navigation buttons
    container.addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new SecondaryButtonBuilder()
            .setLabel('Prev')
            .setCustomId('hunt-prev-page')
            .setDisabled(safePageIdx === 0),
          new PrimaryButtonBuilder()
            .setLabel(`${safePageIdx + 1} / ${Math.max(1, totalPages)}`)
            .setCustomId('hunt-page-counter')
            .setDisabled(true),
          new SecondaryButtonBuilder()
            .setLabel('Next')
            .setCustomId('hunt-next-page')
            .setDisabled(safePageIdx >= totalPages - 1)
        )
    );

    // Separator
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    // Stats button
    container.addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new SecondaryButtonBuilder()
            .setLabel('Stats')
            .setCustomId('hunt-view-stats'),
          new SecondaryButtonBuilder()
            .setLabel('Hive')
            .setCustomId('hunt-open-hive'),
          new PrimaryButtonBuilder()
            .setLabel('Hunt')
            .setCustomId('hunt-go-now'),
          new SecondaryButtonBuilder()
            .setLabel('Inventory')
            .setCustomId('hunt-open-inventory')
        )
    );
  } else if (expired) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Host list view expired_'));
  }

  return [container];
}

function buildStatsPage({ userId, allHosts, cfgHosts, emojis = {}, client = null }) {
  const container = new ContainerBuilder();

  const totalHunts = allHosts.length;
  const hostTypeCounts = {};
  const rarityMap = {};
  let rarest = null;
  let rarestHostType = null;
  let rarestRarity = 'common';

  allHosts.forEach(h => {
    hostTypeCounts[h.host_type] = (hostTypeCounts[h.host_type] || 0) + 1;
    const info = cfgHosts[h.host_type] || {};
    const rarity = info.rarity || 'common';
    if (!rarityMap[rarity]) rarityMap[rarity] = [];
    rarityMap[rarity].push(h.host_type);

    const rarityOrder = { 'common': 0, 'rare': 1, 'very_rare': 2 };
    if ((rarityOrder[rarity] || 0) > (rarityOrder[rarestRarity] || 0)) {
      rarest = getHostDisplay(h.host_type, cfgHosts, emojis);
      rarestHostType = h.host_type;
      rarestRarity = rarity;
    }
  });

  // Use rarest host's emoji if available, otherwise fallback to bot avatar
  let hostEmojiUrl = null;
  if (rarestHostType) {
    hostEmojiUrl = getHostEmojiUrl(rarestHostType, cfgHosts, emojis);
  }
  
  if (hostEmojiUrl) {
    addV2TitleWithImageThumbnail({ container, title: 'Hunt Statistics', imageUrl: hostEmojiUrl });
  } else {
    addV2TitleWithBotThumbnail({ container, title: 'Hunt Statistics', client });
  }

  const mostCommon = Object.entries(hostTypeCounts).sort((a, b) => b[1] - a[1])[0];
  const mostCommonDisplay = mostCommon ? getHostDisplay(mostCommon[0], cfgHosts, emojisCfg) : 'None';
  const mostCommonCount = mostCommon ? mostCommon[1] : 0;

  const stats = [
    `**Total Hosts:** ${totalHunts}`,
    `**Most Common:** ${mostCommonDisplay} (×${mostCommonCount})`,
    `**Rarest Owned:** ${rarest || 'None'} ${rarest ? getRarityBadge(rarestRarity) : ''}`,
    `**Unique Types:** ${Object.keys(hostTypeCounts).length}`
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(stats.join('\n')));

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder().setCustomId('hunt-back-to-list').setLabel('Back to Hosts')
  );
  container.addActionRowComponents(backRow);

  return [container];
}

const cmd = getCommandConfig('hunt') || { name: 'hunt', description: 'Hunt for hosts to use in evolutions' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description)
    .addSubcommands(sub => sub.setName('go').setDescription('Go hunt for a host (chance to find one)'))
    .addSubcommands(sub => sub.setName('list').setDescription('List your hunted hosts')),

  async executeInteraction(interaction) {
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const userId = interaction.user.id;
    const cfgHosts = (hostsCfg && hostsCfg.hosts) || {};
    const hostKeys = Object.keys(cfgHosts || {});

    if (sub === 'go') {
      try {
        const findChance = Number((hostsCfg && hostsCfg.findChance) || 0.75);
        const found = Math.random() < findChance;

        if (!found) {
          return safeReply(interaction, { content: 'You searched but found no suitable hosts this time.', ephemeral: true }, { loggerName: 'command:hunt' });
        }

        // Track hunt
        try {
          const user = await userModel.getUserByDiscordId(userId);
          if (user && user.data) {
            user.data.hunt_stats = user.data.hunt_stats || {};
            user.data.hunt_stats.total_hunts = (user.data.hunt_stats.total_hunts || 0) + 1;
            await userModel.updateUserDataRawById(user.id, user.data);
          }
        } catch (e) {
          logger.warn('Failed tracking hunt stat', { userId, error: e && e.message });
        }

        const weights = hostKeys.map(k => Number(cfgHosts[k].weight || 1));
        const total = weights.reduce((s, v) => s + v, 0);
        let pick = Math.floor(Math.random() * total);
        let chosenKey = hostKeys[0] || 'human';
        for (let i = 0; i < hostKeys.length; i++) {
          if (pick < weights[i]) { chosenKey = hostKeys[i]; break; }
          pick -= weights[i];
        }

        const hostDisplay = getHostDisplay(chosenKey, cfgHosts, emojisCfg);
        const flavor = getRandomFlavor(chosenKey, huntFlavorsCfg);
        const host = await hostModel.addHostForUser(userId, chosenKey);

        // Get emoji and construct image URL
        const hostInfo = cfgHosts[chosenKey] || {};
        const emojiKey = hostInfo.emoji;
        const emoji = emojiKey && emojisCfg[emojiKey] ? emojisCfg[emojiKey] : '';
        let emojiUrl = null;
        
        if (emoji) {
          // Parse custom emoji format <:name:id> or <a:name:id>
          const emojiMatch = emoji.match(/<a?:(\w+):(\d+)>/);
          if (emojiMatch) {
            const isAnimated = emoji.startsWith('<a:');
            const emojiId = emojiMatch[2];
            emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}?size=256`;
          }
        }

        const container = new ContainerBuilder();
        if (emojiUrl) {
          addV2TitleWithImageThumbnail({ container, title: 'Hunt Success', imageUrl: emojiUrl });
        } else {
          addV2TitleWithBotThumbnail({ container, title: 'Hunt Success', client: interaction.client });
        }
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(flavor),
          new TextDisplayBuilder().setContent(`You acquired: **${hostDisplay}** (ID: ${host.id})`)
        );

        const resultRow = new ActionRowBuilder()
          .addComponents(
            new PrimaryButtonBuilder().setCustomId('hunt-view-list-from-result').setLabel('View Hunt List')
          );
        container.addActionRowComponents(resultRow);

        const payload = { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true };
        if (emojiUrl) {
          payload.files = [{ attachment: emojiUrl, name: 'host.png' }];
        }

        await safeReply(
          interaction,
          payload,
          { loggerName: 'command:hunt' }
        );

        let msg = null;
        try { msg = await interaction.fetchReply(); } catch (_) {}
        if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

        const resultCollector = msg.createMessageComponentCollector({
          filter: i => i.user.id === userId,
          time: 300_000
        });

        resultCollector.on('collect', async i => {
          try {
            if (i.customId === 'hunt-view-list-from-result') {
              const rows = await hostModel.listHostsByOwner(userId);
              if (!rows || rows.length === 0) {
                await i.update({ content: 'You have no hunted hosts.', components: [] });
              } else {
                await i.update({ components: buildHostListPage({ pageIdx: 0, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }) });
              }
            }
          } catch (err) {
            try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hunt' }); } catch (_) {}
          }
        });

        resultCollector.on('end', () => {
          try { msg.edit({ components: [] }).catch(() => {}); } catch (_) {}
        });

        return;
      } catch (e) {
        return safeReply(interaction, { content: `Hunt failed: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:hunt' });
      }
    }

    if (sub === 'list') {
      try {
        let rows = await hostModel.listHostsByOwner(userId);

        if (!rows || rows.length === 0) {
          return safeReply(interaction, { content: 'You have no hunted hosts. Use `/hunt go` to search.', ephemeral: true }, { loggerName: 'command:hunt' });
        }

        await safeReply(
          interaction,
          { components: buildHostListPage({ pageIdx: 0, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true },
          { loggerName: 'command:hunt' }
        );

        let msg = null;
        try { msg = await interaction.fetchReply(); } catch (_) {}
        if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

        let currentPage = 0;
        let currentViewMode = 'list'; // 'list', 'stats'

        const collector = msg.createMessageComponentCollector({
          filter: i => i.user.id === userId,
          time: 300_000
        });

        collector.on('collect', async i => {
          try {
            // Navigation
            if (i.customId === 'hunt-prev-page') {
              currentPage = Math.max(0, currentPage - 1);
              await i.update({ components: buildHostListPage({ pageIdx: currentPage, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }) });
              return;
            }
            if (i.customId === 'hunt-next-page') {
              const totalPages = Math.ceil(rows.length / HOSTS_PER_PAGE);
              currentPage = Math.min(totalPages - 1, currentPage + 1);
              await i.update({ components: buildHostListPage({ pageIdx: currentPage, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }) });
              return;
            }

            // Delete single host
            if (i.customId.startsWith('hunt-delete-one:')) {
              const hostId = Number(i.customId.split(':')[1]);
              await hostModel.deleteHostsById([hostId]);
              rows = rows.filter(r => r.id !== hostId);
              
              // Adjust current page if empty
              const totalPages = Math.ceil(rows.length / HOSTS_PER_PAGE);
              if (currentPage >= totalPages && currentPage > 0) {
                currentPage = totalPages - 1;
              }
              
              await i.update({ components: buildHostListPage({ pageIdx: currentPage, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }) });
              currentViewMode = 'list';
              return;
            }

            // View stats
            if (i.customId === 'hunt-view-stats') {
              await i.update({ components: buildStatsPage({ userId, allHosts: rows, cfgHosts, emojis: emojisCfg, client: interaction.client }) });
              currentViewMode = 'stats';
              return;
            }

            // Quick hive access (or create if missing)
            if (i.customId === 'hunt-open-hive') {
              const existingHive = await hiveModel.getHiveByUser(userId);
              if (existingHive) {
                await i.reply({
                  content: `🏰 **Hive Found**\nID: ${existingHive.id}\nType: ${existingHive.type || existingHive.hive_type || 'default'}\nCapacity: ${existingHive.capacity || 0}\nUse \`/hive stats\` for the full hive screen.`,
                  ephemeral: true
                });
                return;
              }

              let xenos = [];
              try { xenos = await xenomorphModel.getXenosByOwner(userId); } catch (_) { xenos = []; }
              const hasEvolved = Array.isArray(xenos) && xenos.some(x => (x.role && x.role !== 'egg') || (x.stage && x.stage !== 'egg'));
              if (!hasEvolved) {
                await i.reply({
                  content: '❌ You need at least one xenomorph evolved beyond egg stage to create a hive.',
                  ephemeral: true
                });
                return;
              }

              const newHive = await hiveModel.createHiveForUser(userId, { type: 'default', name: `${interaction.user.username}'s Hive` });
              await i.reply({ content: `✅ Hive created (ID: ${newHive.id}).`, ephemeral: true });
              return;
            }

            // Quick hunt from list
            if (i.customId === 'hunt-go-now') {
              const findChance = Number((hostsCfg && hostsCfg.findChance) || 0.75);
              const found = Math.random() < findChance;
              if (!found) {
                await i.reply({ content: 'You searched but found no suitable hosts this time.', ephemeral: true });
                return;
              }

              const weights = hostKeys.map(k => Number(cfgHosts[k].weight || 1));
              const total = weights.reduce((s, v) => s + v, 0);
              let pick = Math.floor(Math.random() * total);
              let chosenKey = hostKeys[0] || 'human';
              for (let idx = 0; idx < hostKeys.length; idx++) {
                if (pick < weights[idx]) { chosenKey = hostKeys[idx]; break; }
                pick -= weights[idx];
              }

              const host = await hostModel.addHostForUser(userId, chosenKey);
              rows.push(host);
              await i.reply({
                content: `🎯 Hunt success! You found **${getHostDisplay(chosenKey, cfgHosts, emojisCfg)}** (ID: ${host.id}).`,
                ephemeral: true
              });
              return;
            }

            // Quick inventory summary
            if (i.customId === 'hunt-open-inventory') {
              let xenos = [];
              try { xenos = await xenomorphModel.getXenosByOwner(userId); } catch (_) { xenos = []; }
              const hostCount = Array.isArray(rows) ? rows.length : 0;
              const xenoCount = Array.isArray(xenos) ? xenos.length : 0;
              await i.reply({
                content: `🎒 **Inventory**\nHosts: ${hostCount}\nXenomorphs: ${xenoCount}\nUse \`/inventory\` to open full inventory view.`,
                ephemeral: true
              });
              return;
            }

            // Back to list
            if (i.customId === 'hunt-back-to-list') {
              currentPage = 0;
              await i.update({ components: buildHostListPage({ pageIdx: 0, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }) });
              currentViewMode = 'list';
              return;
            }
          } catch (err) {
            try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hunt' }); } catch (_) {}
          }
        });

        collector.on('end', async () => {
          try {
            if (msg) {
              await msg.edit({ components: buildHostListPage({ pageIdx: currentPage, rows, cfgHosts, emojis: emojisCfg, expired: true, client: interaction.client }) });
            }
          } catch (_) {}
        });

        return;
      } catch (e) {
        return safeReply(interaction, { content: `Failed listing hosts: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:hunt' });
      }
    }

    return safeReply(interaction, { content: 'Unknown hunt subcommand.', ephemeral: true }, { loggerName: 'command:hunt' });
  },

  async autocomplete(interaction) {
    return;
  }
};

