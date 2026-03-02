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
const db = require('../../db');
const { getCommandConfig } = require('../../utils/commandsConfig');
const hostsCfg = require('../../../config/hosts.json');
const emojisCfg = require('../../../config/emojis.json');
const huntFlavorsCfg = require('../../../config/huntFlavors.json');
const { addV2TitleWithBotThumbnail, addV2TitleWithImageThumbnail } = require('../../utils/componentsV2');
const safeReply = require('../../utils/safeReply');
const logger = require('../../utils/logger').get('command:hunt-list');

const HOSTS_PER_PAGE = 4;

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

  if (!page || page.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('No hosts on this page.'));
  } else {
    for (const host of page) {
      const display = getHostDisplay(host.host_type, cfgHosts, emojis);
      const rarity = host.rarity || 'common';
      const badge = getRarityBadge(rarity);
      const section = new SectionBuilder()
        .setSuccessButtonAccessory((button) =>
          button
            .setLabel('Release')
            .setCustomId(`hunt-delete-one:${host.id}`)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**${display}** • ${badge}\nID: ${host.id}\nCaught: <t:${Math.floor(host.created_at / 1000)}:R>`)
        );
      container.addSectionComponents(section);
    }
  }

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // Pagination + Stats Row
  const totalHunts = rows.length;
  const navRow = new ActionRowBuilder();
  if (safePageIdx > 0) {
    navRow.addComponents(
      new SecondaryButtonBuilder().setCustomId('hunt-prev-page').setLabel('Prev')
    );
  }
  const pageInfo = totalPages > 1 ? ` (${safePageIdx + 1}/${totalPages})` : '';
  const pageBtn = new SecondaryButtonBuilder()
    .setCustomId('hunt-page-info')
    .setLabel(`Total: ${totalHunts}${pageInfo}`)
    .setDisabled(true);
  navRow.addComponents(pageBtn);

  if (safePageIdx < totalPages - 1) {
    navRow.addComponents(
      new SecondaryButtonBuilder().setCustomId('hunt-next-page').setLabel('Next')
    );
  }

  container.addActionRowComponents(navRow);

  // Stats + Hunt Row
  const actionRow = new ActionRowBuilder()
    .addComponents(
      new PrimaryButtonBuilder().setCustomId('hunt-view-stats').setLabel('Stats'),
      new PrimaryButtonBuilder().setCustomId('hunt-go-now').setLabel('Hunt')
    );
  container.addActionRowComponents(actionRow);

  return [container];
}

function buildStatsPage({ userId, allHosts = [], cfgHosts = {}, emojis = {}, client = null }) {
  const rarityOrder = { 'very_rare': 3, 'rare': 2, 'common': 1 };
  const hostTypeCounts = {};
  let rarest = null;
  let rarestRarity = null;
  let rarestHostType = null;

  for (const host of allHosts) {
    const type = host.host_type;
    hostTypeCounts[type] = (hostTypeCounts[type] || 0) + 1;
    const rarity = host.rarity || 'common';
    if (!rarestRarity || (rarityOrder[rarity] || 0) >= (rarityOrder[rarestRarity] || 0)) {
      rarestRarity = rarity;
      rarest = getHostDisplay(type, cfgHosts, emojis);
      rarestHostType = type;
    }
  }

  const totalHunts = allHosts.length;
  const container = new ContainerBuilder();

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
  const mostCommonDisplay = mostCommon ? getHostDisplay(mostCommon[0], cfgHosts, emojis) : 'None';
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

const cmd = getCommandConfig('hunt-list') || { name: 'hunt-list', description: 'List your hunted hosts' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description),

  async executeInteraction(interaction) {
    const userId = interaction.user.id;
    const cfgHosts = (hostsCfg && hostsCfg.hosts) || {};
    const hostKeys = Object.keys(cfgHosts || {});

    try {
      let rows = await hostModel.listHostsByOwner(userId);

      if (!rows || rows.length === 0) {
        return safeReply(interaction, { content: 'You have no hunted hosts. Use `/hunt` to search.', ephemeral: true }, { loggerName: 'command:hunt-list' });
      }

      await safeReply(
        interaction,
        { components: buildHostListPage({ pageIdx: 0, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true },
        { loggerName: 'command:hunt-list' }
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

          // Quick hunt from list
          if (i.customId === 'hunt-go-now') {
            const findChance = Number((hostsCfg && hostsCfg.findChance) || 0.75);
            const found = Math.random() < findChance;
            if (!found) {
              const container = new ContainerBuilder();
              addV2TitleWithBotThumbnail({ container, title: 'Hunt Failed', client: interaction.client });
              container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('You searched but found no suitable hosts this time.')
              );

              const payload = { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true };
              await i.reply(payload);
              return;
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
            for (let idx = 0; idx < hostKeys.length; idx++) {
              if (pick < weights[idx]) { chosenKey = hostKeys[idx]; break; }
              pick -= weights[idx];
            }

            const hostDisplay = getHostDisplay(chosenKey, cfgHosts, emojisCfg);
            const flavor = getRandomFlavor(chosenKey, huntFlavorsCfg);
            const host = await hostModel.addHostForUser(userId, chosenKey);
            rows.push(host);

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
                new PrimaryButtonBuilder().setCustomId('hunt-result-back-to-list').setLabel('Back to Hunt List')
              );
            container.addActionRowComponents(resultRow);

            const payload = { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true };

            await i.reply(payload);

            let huntMsg = null;
            try { huntMsg = await i.fetchReply(); } catch (_) {}
            if (!huntMsg || typeof huntMsg.createMessageComponentCollector !== 'function') return;

            const huntCollector = huntMsg.createMessageComponentCollector({
              filter: btn => btn.user.id === userId,
              time: 300_000
            });

            huntCollector.on('collect', async btn => {
              try {
                if (btn.customId === 'hunt-result-back-to-list') {
                  await btn.update({ components: buildHostListPage({ pageIdx: 0, rows, cfgHosts, emojis: emojisCfg, client: interaction.client }) });
                }
              } catch (err) {
                try { await safeReply(btn, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hunt-list' }); } catch (_) {}
              }
            });

            huntCollector.on('end', async () => {
              try {
                if (huntMsg) {
                  const endContainer = new ContainerBuilder();
                  if (emojiUrl) {
                    addV2TitleWithImageThumbnail({ container: endContainer, title: 'Hunt Success', imageUrl: emojiUrl });
                  } else {
                    addV2TitleWithBotThumbnail({ container: endContainer, title: 'Hunt Success', client: interaction.client });
                  }
                  endContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(flavor),
                    new TextDisplayBuilder().setContent(`You acquired: **${hostDisplay}** (ID: ${host.id})`)
                  );
                  await huntMsg.edit({ components: [endContainer] });
                }
              } catch (_) {}
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
          try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hunt-list' }); } catch (_) {}
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
      return safeReply(interaction, { content: `Failed listing hosts: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:hunt-list' });
    }
  },

  async autocomplete(interaction) {
    return;
  }
};
