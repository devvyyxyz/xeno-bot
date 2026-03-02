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
const guildModel = require('../../models/guild');
const hiveModel = require('../../models/hive');
const xenomorphModel = require('../../models/xenomorph');
const db = require('../../db');
const { getCommandConfig } = require('../../utils/commandsConfig');
const { checkCommandRateLimit } = require('../../utils/rateLimiter');
const hostsCfg = require('../../../config/hosts.json');
const emojisCfg = require('../../../config/emojis.json');
const huntFlavorsCfg = require('../../../config/huntFlavors.json');
const guildDefaultsCfg = require('../../../config/guildDefaults.json');
const { addV2TitleWithBotThumbnail, addV2TitleWithImageThumbnail } = require('../../utils/componentsV2');
const safeReply = require('../../utils/safeReply');
const logger = require('../../utils/logger').get('command:hunt');

const HOSTS_PER_PAGE = 4;

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
          new PrimaryButtonBuilder()
            .setLabel('Hunt')
            .setCustomId('hunt-go-now')
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
    if ((rarityOrder[rarity] || 0) >= (rarityOrder[rarestRarity] || 0)) {
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

async function performHunt(interaction, client) {
  // Rate limit check - prevents spam and abuse
  if (!await checkCommandRateLimit(interaction, 'expensive')) {
    return; // Rate limit message already sent to user
  }

  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const cfgHosts = (hostsCfg && hostsCfg.hosts) || {};
  const hostKeys = Object.keys(cfgHosts || {});

  try {
    const defaultCooldownSeconds = Math.max(0, Number(guildDefaultsCfg?.data?.hunt_cooldown_seconds || 0));
    let cooldownSeconds = defaultCooldownSeconds;
    try {
      const guildCfg = await guildModel.getGuildConfig(guildId);
      const configured = Number(guildCfg?.data?.hunt_cooldown_seconds);
      if (Number.isFinite(configured)) cooldownSeconds = Math.max(0, configured);
    } catch (e) {
      logger.warn('Failed to read guild hunt cooldown config, using defaults', { guildId, error: e && e.message });
    }

    const nowMs = Date.now();
    const user = await userModel.findOrCreate(userId);
    const userData = user.data || {};
    userData.guilds = userData.guilds || {};
    userData.guilds[guildId] = userData.guilds[guildId] || {};
    userData.guilds[guildId].hunt = userData.guilds[guildId].hunt || {};

    const lastHuntAt = Number(userData.guilds[guildId].hunt.last_hunt_at || 0);
    const cooldownMs = Math.max(0, cooldownSeconds * 1000);

    if (cooldownMs > 0 && lastHuntAt > 0) {
      const elapsed = nowMs - lastHuntAt;
      if (elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed;
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        const readyAtUnix = Math.floor((nowMs + remainingMs) / 1000);
        const container = new ContainerBuilder();
        addV2TitleWithBotThumbnail({ container, title: 'Hunt Cooldown', client });
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`You need to wait **${remainingSeconds}s** before hunting again.`),
          new TextDisplayBuilder().setContent(`Ready: <t:${readyAtUnix}:R>`) 
        );
        const payload = { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true };
        return safeReply(interaction, payload, { loggerName: 'command:hunt' });
      }
    }

    userData.guilds[guildId].hunt.last_hunt_at = nowMs;
    try {
      await userModel.updateUserDataRawById(user.id, userData);
    } catch (e) {
      logger.warn('Failed to persist hunt cooldown timestamp', { userId, guildId, error: e && e.message });
    }

    const findChance = Number((hostsCfg && hostsCfg.findChance) || 0.75);
    const found = Math.random() < findChance;

    if (!found) {
      const container = new ContainerBuilder();
      addV2TitleWithBotThumbnail({ container, title: 'Hunt Failed', client });
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('You searched but found no suitable hosts this time.')
      );

      const payload = { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true };
      return safeReply(interaction, payload, { loggerName: 'command:hunt' });
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
      addV2TitleWithBotThumbnail({ container, title: 'Hunt Success', client });
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

    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === userId,
      time: 300_000
    });

    collector.on('collect', async i => {
      if (i.customId === 'hunt-view-list-from-result') {
        const hostList = await hostModel.getHostsForUser(userId);
        await i.update({ components: buildHostListPage({ rows: hostList, cfgHosts, emojis: emojisCfg, client }) });
      }
    });

    collector.on('end', async () => {
      try {
        if (msg) {
          const container = new ContainerBuilder();
          if (emojiUrl) {
            addV2TitleWithImageThumbnail({ container, title: 'Hunt Success', imageUrl: emojiUrl });
          } else {
            addV2TitleWithBotThumbnail({ container, title: 'Hunt Success', client });
          }
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(flavor),
            new TextDisplayBuilder().setContent(`You acquired: **${hostDisplay}** (ID: ${host.id})`)
          );
          await msg.edit({ components: [container] });
        }
      } catch (_) {}
    });
  } catch (e) {
    return safeReply(interaction, { content: `Hunt failed: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:hunt' });
  }
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description),

  async executeInteraction(interaction) {
    return performHunt(interaction, interaction.client);
  },

  async autocomplete(interaction) {
    return;
  }
};


