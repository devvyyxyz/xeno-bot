const { ChatInputCommandBuilder } = require('@discordjs/builders');
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder,
  DangerButtonBuilder
} = require('@discordjs/builders');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');
const hostModel = require('../../models/host');
const userModel = require('../../models/user');
const db = require('../../db');
const { getCommandConfig } = require('../../utils/commandsConfig');
const hostsCfg = require('../../../config/hosts.json');
const emojisCfg = require('../../../config/emojis.json');
const huntFlavorsCfg = require('../../../config/huntFlavors.json');
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

function buildHostListPage({ pageIdx = 0, rows = [], selectedIds = new Set(), expired = false, cfgHosts = {}, emojis = {} }) {
  const totalPages = Math.ceil(rows.length / HOSTS_PER_PAGE);
  const safePageIdx = Math.max(0, Math.min(pageIdx, totalPages - 1));
  const start = safePageIdx * HOSTS_PER_PAGE;
  const end = start + HOSTS_PER_PAGE;
  const page = rows.slice(start, end);

  const container = new ContainerBuilder();

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Host Collection'));

  if (page.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no hunted hosts. Use `/hunt go` to search.'));
  } else {
    const lines = page.map(r => {
      const isSelected = selectedIds.has(String(r.id));
      const info = cfgHosts[r.host_type] || {};
      const display = getHostDisplay(r.host_type, cfgHosts, emojis);
      const rarity = getRarityBadge(info.rarity || 'common');
      const check = isSelected ? '☑️' : '☐';
      return `${check} **#${r.id}** — ${display} — ${rarity}`;
    }).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
  }

  if (!expired && page.length > 0) {
    const navRow = new ActionRowBuilder()
      .addComponents(
        new SecondaryButtonBuilder().setCustomId('hunt-prev-page').setLabel('◀ Prev').setDisabled(safePageIdx === 0),
        new PrimaryButtonBuilder().setCustomId('hunt-page-counter').setLabel(`${safePageIdx + 1} / ${Math.max(1, totalPages)}`).setDisabled(true),
        new SecondaryButtonBuilder().setCustomId('hunt-next-page').setLabel('Next ▶').setDisabled(safePageIdx >= totalPages - 1)
      );
    container.addActionRowComponents(navRow);

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('hunt-select-host')
        .setPlaceholder('Select a host to view')
        .addOptions(...page.map(r => {
          const info = cfgHosts[r.host_type] || {};
          const display = getHostDisplay(r.host_type, cfgHosts, emojis);
          const desc = `${info.description || ''}`.slice(0, 100);
          return {
            label: `#${r.id} ${display}`.slice(0, 100),
            value: String(r.id),
            description: desc
          };
        }))
    );
    container.addActionRowComponents(selectRow);

    const actionRow = new ActionRowBuilder()
      .addComponents(
        new SecondaryButtonBuilder().setCustomId('hunt-toggle-select').setLabel(`Toggle Select (${selectedIds.size})`),
        new DangerButtonBuilder()
          .setCustomId('hunt-delete-selected')
          .setLabel(`Delete Selected (${selectedIds.size})`)
          .setDisabled(selectedIds.size === 0),
        new SecondaryButtonBuilder().setCustomId('hunt-view-stats').setLabel('📊 Stats')
      );
    container.addActionRowComponents(actionRow);
  } else if (expired) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Host list view expired_'));
  }

  return [container];
}

function buildHostDetailsPage({ host, cfgHosts, emojis }) {
  const info = cfgHosts[host.host_type] || {};
  const display = getHostDisplay(host.host_type, cfgHosts, emojis);
  const rarity = getRarityBadge(info.rarity || 'common');

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${display} [#${host.id}]`),
    new TextDisplayBuilder().setContent(info.description || 'No description available.')
  );

  const fields = [
    `**Rarity:** ${rarity}`,
    `**Type:** \`${host.host_type}\``,
    `**Found:** ${new Date(Number(host.found_at || host.created_at)).toLocaleString()}`,
    `**Host ID:** \`${host.id}\``
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fields.join('\n')));

  const actionRow = new ActionRowBuilder()
    .addComponents(
      new PrimaryButtonBuilder().setCustomId(`hunt-copy-id:${host.id}`).setLabel('📋 Copy ID'),
      new SecondaryButtonBuilder().setCustomId(`hunt-use-evolve:${host.id}`).setLabel('🧬 Use for /evolve'),
      new DangerButtonBuilder().setCustomId(`hunt-delete-one:${host.id}`).setLabel('🗑️ Delete'),
      new SecondaryButtonBuilder().setCustomId('hunt-back-to-list').setLabel('← Back')
    );
  container.addActionRowComponents(actionRow);

  return [container];
}

function buildStatsPage({ userId, allHosts, cfgHosts }) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📊 Hunt Statistics'));

  const totalHunts = allHosts.length;
  const hostTypeCounts = {};
  const rarityMap = {};
  let rarest = null;
  let rarestRarity = 'common';

  allHosts.forEach(h => {
    hostTypeCounts[h.host_type] = (hostTypeCounts[h.host_type] || 0) + 1;
    const info = cfgHosts[h.host_type] || {};
    const rarity = info.rarity || 'common';
    if (!rarityMap[rarity]) rarityMap[rarity] = [];
    rarityMap[rarity].push(h.host_type);

    const rarityOrder = { 'common': 0, 'rare': 1, 'very_rare': 2 };
    if ((rarityOrder[rarity] || 0) > (rarityOrder[rarestRarity] || 0)) {
      rarest = getHostDisplay(h.host_type, cfgHosts, emojisCfg);
      rarestRarity = rarity;
    }
  });

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

  const backRow = new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder().setCustomId('hunt-back-to-list').setLabel('← Back to Hosts')
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

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## 🎯 Hunt Success!'),
          new TextDisplayBuilder().setContent(flavor),
          new TextDisplayBuilder().setContent(`You acquired: **${hostDisplay}** (ID: ${host.id})`)
        );

        const resultRow = new ActionRowBuilder()
          .addComponents(
            new PrimaryButtonBuilder().setCustomId('hunt-view-list-from-result').setLabel('📋 View Hunt List')
          );
        container.addActionRowComponents(resultRow);

        await safeReply(
          interaction,
          { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true },
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
                await i.update({ components: buildHostListPage({ pageIdx: 0, rows, selectedIds: new Set(), cfgHosts, emojis: emojisCfg }) });
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
        const rows = await hostModel.listHostsByOwner(userId);

        if (!rows || rows.length === 0) {
          return safeReply(interaction, { content: 'You have no hunted hosts. Use `/hunt go` to search.', ephemeral: true }, { loggerName: 'command:hunt' });
        }

        await safeReply(
          interaction,
          { components: buildHostListPage({ pageIdx: 0, rows, selectedIds: new Set(), cfgHosts, emojis: emojisCfg }), flags: MessageFlags.IsComponentsV2, ephemeral: true },
          { loggerName: 'command:hunt' }
        );

        let msg = null;
        try { msg = await interaction.fetchReply(); } catch (_) {}
        if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

        let currentPage = 0;
        let selectedIds = new Set();
        let currentViewMode = 'list'; // 'list', 'details', 'stats'
        let selectedHostId = null;

        const collector = msg.createMessageComponentCollector({
          filter: i => i.user.id === userId,
          time: 300_000
        });

        collector.on('collect', async i => {
          try {
            // Navigation
            if (i.customId === 'hunt-prev-page') {
              currentPage = Math.max(0, currentPage - 1);
              await i.update({ components: buildHostListPage({ pageIdx: currentPage, rows, selectedIds, cfgHosts, emojis: emojisCfg }) });
              return;
            }
            if (i.customId === 'hunt-next-page') {
              const totalPages = Math.ceil(rows.length / HOSTS_PER_PAGE);
              currentPage = Math.min(totalPages - 1, currentPage + 1);
              await i.update({ components: buildHostListPage({ pageIdx: currentPage, rows, selectedIds, cfgHosts, emojis: emojisCfg }) });
              return;
            }

            // Host selection
            if (i.customId === 'hunt-select-host') {
              const selected = i.values && i.values[0];
              selectedHostId = selected;
              const host = rows.find(r => String(r.id) === String(selected));
              if (host) {
                await i.update({ components: buildHostDetailsPage({ host, cfgHosts, emojis: emojisCfg }) });
                currentViewMode = 'details';
              }
              return;
            }

            // Toggle select all on current page
            if (i.customId === 'hunt-toggle-select') {
              const start = currentPage * HOSTS_PER_PAGE;
              const end = start + HOSTS_PER_PAGE;
              const pageHosts = rows.slice(start, end);
              const allSelected = pageHosts.every(h => selectedIds.has(String(h.id)));

              if (allSelected) {
                pageHosts.forEach(h => selectedIds.delete(String(h.id)));
              } else {
                pageHosts.forEach(h => selectedIds.add(String(h.id)));
              }
              await i.update({ components: buildHostListPage({ pageIdx: currentPage, rows, selectedIds, cfgHosts, emojis: emojisCfg }) });
              return;
            }

            // Delete selected
            if (i.customId === 'hunt-delete-selected') {
              if (selectedIds.size === 0) return;
              const idsToDelete = Array.from(selectedIds).map(Number);
              await hostModel.deleteHostsById(idsToDelete);
              rows = rows.filter(r => !idsToDelete.includes(r.id));
              selectedIds.clear();
              currentPage = 0;
              await i.update({ components: buildHostListPage({ pageIdx: 0, rows, selectedIds: new Set(), cfgHosts, emojis: emojisCfg }) });
              return;
            }

            // Delete single host
            if (i.customId.startsWith('hunt-delete-one:')) {
              const hostId = Number(i.customId.split(':')[1]);
              await hostModel.deleteHostsById([hostId]);
              rows = rows.filter(r => r.id !== hostId);
              await i.update({ components: buildHostListPage({ pageIdx: currentPage, rows, selectedIds, cfgHosts, emojis: emojisCfg }) });
              currentViewMode = 'list';
              return;
            }

            // Copy ID
            if (i.customId.startsWith('hunt-copy-id:')) {
              const hostId = i.customId.split(':')[1];
              await i.reply({ content: `Host ID: \`${hostId}\` (copied to clipboard in your mind!)`, ephemeral: true });
              return;
            }

            // Use for evolve
            if (i.customId.startsWith('hunt-use-evolve:')) {
              const hostId = i.customId.split(':')[1];
              await i.reply({ content: `To evolve using host #${hostId}, run:\n\`/evolve start\`\nThen provide this as the \`host\` parameter.`, ephemeral: true });
              return;
            }

            // View stats
            if (i.customId === 'hunt-view-stats') {
              await i.update({ components: buildStatsPage({ userId, allHosts: rows, cfgHosts }) });
              currentViewMode = 'stats';
              return;
            }

            // Back to list
            if (i.customId === 'hunt-back-to-list') {
              currentPage = 0;
              await i.update({ components: buildHostListPage({ pageIdx: 0, rows, selectedIds, cfgHosts, emojis: emojisCfg }) });
              currentViewMode = 'list';
              return;
            }
          } catch (err) {
            try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hunt' }); } catch (_) {}
          }
        });

        collector.on('end', async () => {
          try {
            await safeReply(interaction, { components: buildHostListPage({ pageIdx: currentPage, rows, selectedIds, cfgHosts, emojis: emojisCfg, expired: true }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:hunt' });
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

