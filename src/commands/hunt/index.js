const {
  ChatInputCommandBuilder,
  ActionRowBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder,
  DangerButtonBuilder,
} = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('@discordjs/builders');
const hostModel = require('../../models/host');
const userModel = require('../../models/user');
const guildModel = require('../../models/guild');
// hiveModel and xenomorphModel not used in this file; omit to avoid lint warnings
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
const componentsService = require('../../services/components');

const HOSTS_PER_PAGE = 4;

/* mark intentionally-unused requires to satisfy linter */
void db;

// `isValidEmoji` removed — unused helper

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

    // Stats + Release All button
    const anyOnPage = Array.isArray(page) && page.length > 0;
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new SecondaryButtonBuilder().setLabel('Stats').setCustomId('hunt-view-stats'),
        new PrimaryButtonBuilder().setLabel('Hunt').setCustomId('hunt-go-now'),
        new DangerButtonBuilder().setLabel('Release All').setCustomId('hunt-release-all').setDisabled(!anyOnPage)
      )
    );
  } else if (expired) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Host list view expired_'));
  }

  return [container];
}

function buildStatsPage({ userId, allHosts, cfgHosts, emojis = {}, client = null }) {
  void userId;
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

/* keep for future UI use; mark used to satisfy linter */
void buildStatsPage;

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
    let user = await userModel.findOrCreate(userId);
    if (!user) {
      // As a fallback, try to create the user explicitly and refetch.
      try {
        await userModel.createUser(userId, {});
        user = await userModel.getUserByDiscordId(userId);
      } catch (err) {
        logger.error('Failed to create or fetch user for hunt', { userId, error: err && (err.stack || err) });
      }
    }
    if (!user) {
      // Give a helpful ephemeral error rather than crashing due to null access.
      return safeReply(interaction, { content: 'Unable to initialize your user profile right now; please try again shortly.', ephemeral: true }, { loggerName: 'command:hunt' });
    }
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
      // On failed hunts, there's a chance to still find items.
      const container = new ContainerBuilder();
      addV2TitleWithBotThumbnail({ container, title: 'Hunt Failed', client });
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('You searched but found no suitable hosts this time.')
      );

      const spawned = [];
      try {
        // ensure user exists
        await userModel.findOrCreate(userId);

        // 80% chance to spawn scrap (1-5)
        if (Math.random() < 0.8) {
          const qty = Math.floor(Math.random() * 5) + 1;
          try {
            await userModel.addItemForGuild(userId, guildId, 'scrap', qty);
            const emojis = require('../../../config/emojis.json');
            spawned.push(`${qty} ${emojis.scrap || '<:scrap:1479934663882576053>'}`);
          } catch (e) {
            logger.warn('Failed to add scrap to user inventory', { userId, guildId, error: e && e.message });
          }
        }

        // 0.001% chance to spawn a Pathogen Reagent
        if (Math.random() < 0.00001) {
          try {
            await userModel.addItemForGuild(userId, guildId, 'pathogen', 1);
            spawned.push('Pathogen Reagent');
          } catch (e) {
            logger.warn('Failed to add pathogen to user inventory', { userId, guildId, error: e && e.message });
          }
        }
      } catch (e) {
        logger.warn('Failed during failed-hunt spawn logic', { userId, guildId, error: e && e.message });
      }

      if (spawned.length > 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`You also found: ${spawned.join(', ')}`));
      }

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
    const host = await hostModel.addHostForUser(userId, chosenKey, { guild_id: guildId });

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
    try { msg = await interaction.fetchReply(); } catch (_) { /* ignore */ void 0; }
    if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

    let rows = [];
    let currentPage = 0;
    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === userId,
      time: 300_000
    });

    collector.on('collect', async i => {
      // Show host list from the result view
        if (i.customId === 'hunt-view-list-from-result') {
        rows = await hostModel.listHostsByOwner(userId, guildId);
        currentPage = 0;
        await componentsService.updateInteraction(i, { components: buildHostListPage({ rows, cfgHosts, emojis: emojisCfg, client }), flags: MessageFlags.IsComponentsV2 });
        return;
      }

      // Release all hosts on current page when using the embedded host list
      if (i.customId === 'hunt-release-all') {
        try {
          const start = currentPage * HOSTS_PER_PAGE;
          const end = start + HOSTS_PER_PAGE;
          const pageHosts = rows.slice(start, end) || [];
          const ids = pageHosts.map(h => h.id).filter(Boolean);
          if (ids.length) {
            await hostModel.deleteHostsById(ids);
            rows = rows.filter(r => !ids.includes(r.id));
            const totalPages = Math.ceil(rows.length / HOSTS_PER_PAGE);
            if (currentPage >= totalPages && currentPage > 0) currentPage = totalPages - 1;
          }
        } catch (err) {
          try { await safeReply(i, { content: `Failed releasing hosts: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hunt' }); } catch (_) { /* ignore */ void 0; }
        }
        await componentsService.updateInteraction(i, { components: buildHostListPage({ rows, pageIdx: currentPage, cfgHosts, emojis: emojisCfg, client }), flags: MessageFlags.IsComponentsV2 });
        return;
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
          await componentsService.updateInteraction(msg, { components: [container] });
        }
      } catch (_) { /* ignore */ void 0; }
    });
  } catch (e) {
    const formatErrorMessage = require('../../utils/formatErrorMessage');
    return safeReply(interaction, { content: formatErrorMessage(e), ephemeral: true }, { loggerName: 'command:hunt' });
  }
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  performHunt,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description),

  async executeInteraction(interaction) {
    return performHunt(interaction, interaction.client);
  },

  async autocomplete(/* interaction */) {
    return;
  }
};


