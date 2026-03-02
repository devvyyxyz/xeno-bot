const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('@discordjs/builders');
const userModel = require('../../models/user');
const eggTypes = require('../../../config/eggTypes.json');
const fallbackLogger = require('../../utils/fallbackLogger');
const createInteractionCollector = require('../../utils/collectorHelper');
const safeReply = require('../../utils/safeReply');
const { addV2TitleWithGuildThumbnail } = require('../../utils/componentsV2');

const cmd = getCommandConfig('leaderboard') || {
  name: 'leaderboard',
  description: 'View the top collectors and catchers.'
};

function buildLeaderboardV2Components({
  title,
  description,
  footer,
  sortChoices,
  selectedSort,
  showEggType = false,
  eggTypeChoices = [],
  expired = false,
  guildAvatarUrl = null
}) {
  const container = new ContainerBuilder();
  addV2TitleWithGuildThumbnail({ container, title: String(title || 'Leaderboard'), guildAvatarUrl });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description && String(description).trim().length ? String(description) : 'No data.'));

  if (!expired) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const sortOptions = (sortChoices || []).slice(0, 25).map(opt => ({
      label: String(opt.label),
      value: String(opt.value),
      default: String(opt.value) === String(selectedSort)
    }));

    if (sortOptions.length > 0) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('leaderboard-sort')
            .setPlaceholder('Sort by...')
            .addOptions(...sortOptions)
        )
      );
    }

    if (showEggType && Array.isArray(eggTypeChoices) && eggTypeChoices.length > 0) {
      const eggOptions = eggTypeChoices.slice(0, 25).map(opt => ({
        label: String(opt.label),
        value: String(opt.value)
      }));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('leaderboard-eggtype')
            .setPlaceholder('Sort by egg type...')
            .addOptions(...eggOptions)
        )
      );
    }
  }

  if (footer) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`_${String(footer)}${expired ? ' • View expired' : ''}_`));
  return [container];
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
    options: buildSubcommandOptions('leaderboard', [
      {
        name: 'server',
        description: 'Show local server leaderboard (placeholder)',
        type: 1,
        options: [{name: 'sort', description: 'Sort by', type: 3, required: false, autocomplete: true}]
      },
      {
        name: 'global',
        description: 'Show global leaderboard (placeholder)',
        type: 1,
        options: [{name: 'sort', description: 'Sort by', type: 3, required: false, autocomplete: true}]
      }
    ])
  },
   async autocomplete(interaction) {
     const eggTypes = require('../../../config/eggTypes.json');
     const autocomplete = require('../../utils/autocomplete');
     const base = [
       { id: 'eggs', name: 'Total Eggs' },
       { id: 'fastest', name: 'Fastest Catch' },
       { id: 'slowest', name: 'Slowest Catch' },
       { id: 'rarity', name: 'Egg Rarity' }
     ];
     const eggItems = eggTypes.map(e => ({ id: `eggtype_${e.id}`, name: `${e.name} Eggs` }));
     const items = base.concat(eggItems);
     return autocomplete(interaction, items, { map: it => ({ name: it.name, value: it.id }), max: 25 });
   },

  async executeInteraction(interaction) {
    const logger = require('../../utils/logger').get('command:leaderboard');
    // determine subcommand (if any)
    let sub = null;
    try { sub = interaction.options && interaction.options.getSubcommand ? (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })() : null; } catch (e) { sub = null; }
    const sort = (sub === 'server') ? (interaction.options.getString('sort') || 'eggs') : (interaction.options.getString('sort') || 'eggs');
    if (!(interaction.isStringSelectMenu && interaction.isStringSelectMenu())) {
      await interaction.deferReply({ ephemeral: cmd.ephemeral === true });
    }
    // Get all users in DB
    const baseLogger = require('../../utils/logger');
    if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.getAllUsers.start', category: 'db' }); } catch (e) { try { logger && logger.warn && logger.warn('Failed to add sentry breadcrumb (db.getAllUsers.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard breadcrumb (db.getAllUsers.start)', le && (le.stack || le)); } catch (ignored) {} } } }
    const rows = await userModel.getAllUsers();
    if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.getAllUsers.finish', category: 'db', data: { count: rows.length } }); } catch (e) { try { logger && logger.warn && logger.warn('Failed to add sentry breadcrumb (db.getAllUsers.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard breadcrumb (db.getAllUsers.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
    const guildId = interaction.guildId;

    // If global subcommand requested, build server-level totals and show global ranking
    if (sub === 'global') {
      const sortOpt = interaction.options.getString('sort') || 'eggs';
      const guildStats = {};
      // Initialize containers: for eggs totals (per type), rarity, catchTimes
      for (const user of rows) {
        const data = user.data || {};
        const g = data.guilds || {};
        const stats = data.stats || {};
        for (const [gid, gd] of Object.entries(g)) {
          guildStats[gid] = guildStats[gid] || { eggsByType: {}, total: 0, catchTimes: [] };
          try {
            const eggsObj = (gd && gd.eggs) || {};
            for (const [etype, count] of Object.entries(eggsObj)) {
              const n = Number(count) || 0;
              guildStats[gid].eggsByType[etype] = (guildStats[gid].eggsByType[etype] || 0) + n;
              guildStats[gid].total = (guildStats[gid].total || 0) + n;
            }
          } catch (e) { }
          // include user's catchTimes for this guild if user has presence here
          try {
            if (stats && stats.catchTimes && stats.catchTimes.length) {
              guildStats[gid].catchTimes = guildStats[gid].catchTimes.concat(stats.catchTimes);
            }
          } catch (e) { }
        }
      }

      // Build sortable entries
      const entries = Object.entries(guildStats).map(([gid, info]) => ({ gid, info }));

      // Sorting by requested option
      if (sortOpt === 'eggs') {
        entries.sort((a, b) => (b.info.total || 0) - (a.info.total || 0));
      } else if (sortOpt === 'rarity') {
        entries.forEach(e => {
          let score = 0;
          for (const type of eggTypes) {
            score += (e.info.eggsByType[type.id] || 0) * (type.rarity || 1);
          }
          e.info.rarityScore = score;
        });
        entries.sort((a, b) => (b.info.rarityScore || 0) - (a.info.rarityScore || 0));
      } else if (sortOpt.startsWith('eggtype_')) {
        const typeId = sortOpt.replace('eggtype_', '');
        entries.sort((a, b) => (b.info.eggsByType[typeId] || 0) - (a.info.eggsByType[typeId] || 0));
      } else if (sortOpt === 'fastest') {
        entries.forEach(e => { e.info.best = (e.info.catchTimes && e.info.catchTimes.length) ? Math.min(...e.info.catchTimes) : null; });
        entries.filter(e => e.info.best !== null).sort((a, b) => a.info.best - b.info.best);
        entries.sort((a, b) => {
          const A = a.info.best === null ? Number.POSITIVE_INFINITY : a.info.best;
          const B = b.info.best === null ? Number.POSITIVE_INFINITY : b.info.best;
          return A - B;
        });
      } else if (sortOpt === 'slowest') {
        entries.forEach(e => { e.info.worst = (e.info.catchTimes && e.info.catchTimes.length) ? Math.max(...e.info.catchTimes) : null; });
        entries.sort((a, b) => {
          const A = a.info.worst === null ? -Infinity : a.info.worst;
          const B = b.info.worst === null ? -Infinity : b.info.worst;
          return B - A;
        });
      }

      const top = entries.slice(0, 10);
      let desc = '';
      for (let i = 0; i < top.length; i++) {
        const entry = top[i];
        const gid = entry.gid;
        // Try cache first, then fetch if missing. If still missing, use stored guild config name if available.
        let guildName = null;
        try {
          const cached = interaction.client && interaction.client.guilds && interaction.client.guilds.cache ? interaction.client.guilds.cache.get(gid) : null;
          if (cached && cached.name) guildName = cached.name;
          else if (interaction.client && interaction.client.guilds && typeof interaction.client.guilds.fetch === 'function') {
            try {
              const fetched = await interaction.client.guilds.fetch(gid).catch(() => null);
              if (fetched && fetched.name) guildName = fetched.name;
            } catch (e) { }
          }
          // final fallback: try guild settings cache (may have stored display name in data)
          if (!guildName) {
            try {
              const guildModel = require('../../models/guild');
              const cfg = await guildModel.getGuildConfig(gid).catch ? await guildModel.getGuildConfig(gid) : null;
              if (cfg && cfg.data) {
                const possible = cfg.data.name || cfg.data.guildName || cfg.data.guild_name || cfg.data.displayName || cfg.data.display_name;
                if (possible) guildName = possible;
              }
            } catch (e) { }
          }
        } catch (e) { }
        const displayName = guildName ? `${guildName}` : `Guild ${gid}`;
        // Format value per sort
        let value = '';
        if (sortOpt === 'eggs') value = `**${entry.info.total || 0} eggs**`;
        else if (sortOpt === 'rarity') value = `**${entry.info.rarityScore || 0} rarity**`;
        else if (sortOpt.startsWith('eggtype_')) {
          const t = sortOpt.replace('eggtype_', '');
          const eggType = eggTypes.find(e => e.id === t);
          value = eggType ? `${eggType.emoji} **${entry.info.eggsByType[t] || 0}**` : `**${entry.info.eggsByType[t] || 0}**`;
        } else if (sortOpt === 'fastest') value = (entry.info.best !== null && typeof entry.info.best === 'number') ? `**${(entry.info.best/1000).toFixed(2)}s**` : 'No data';
        else if (sortOpt === 'slowest') value = (entry.info.worst !== null && typeof entry.info.worst === 'number') ? `**${(entry.info.worst/1000/3600).toFixed(2)}h**` : 'No data';
        desc += `#${i+1} ${displayName} — ${value}\n`;
      }

      const totalServers = entries.length;
      const idx = entries.findIndex(e => e.gid === String(guildId));
      const rank = idx >= 0 ? idx + 1 : 'Unranked';
      const currentTotal = (guildStats[String(guildId)] && ((sortOpt === 'eggs') ? guildStats[String(guildId)].total : (sortOpt.startsWith('eggtype_') ? (guildStats[String(guildId)].eggsByType[sortOpt.replace('eggtype_', '')] || 0) : (sortOpt === 'rarity' ? (() => { let s=0; for(const t of eggTypes){ s += (guildStats[String(guildId)].eggsByType[t.id]||0)*(t.rarity||1);} return s; })() : 0)))) || 0;

      const sortChoices = [
        { label: 'Total Eggs', value: 'eggs' },
        { label: 'Fastest Catch', value: 'fastest' },
        { label: 'Slowest Catch', value: 'slowest' },
        { label: 'Egg Rarity', value: 'rarity' }
      ];
      const eggTypeChoices = eggTypes.map(e => ({
        label: `${e.name} Eggs`.length > 25 ? `${e.name} Eggs`.slice(0, 22) + '...' : `${e.name} Eggs`,
        value: `eggtype_${e.id}`.length > 25 ? `eggtype_${e.id}`.slice(0, 22) + '...' : `eggtype_${e.id}`
      }));
      const sortLabel = ({ eggs: 'Total Eggs', rarity: 'Egg Rarity', fastest: 'Fastest Catch', slowest: 'Slowest Catch' }[sortOpt] || (sortOpt.startsWith('eggtype_') ? `Egg Type ${sortOpt.replace('eggtype_','')}` : sortOpt));
      const footer = `This server: #${rank} / ${totalServers} — ${currentTotal} ${sortLabel ? `(${sortLabel})` : ''}`;
      const guildAvatarUrl = interaction.guild && typeof interaction.guild.iconURL === 'function' ? interaction.guild.iconURL({ size: 256 }) : null;
      const components = buildLeaderboardV2Components({
        title: 'Leaderboard',
        description: desc || 'No server data.',
        footer,
        sortChoices,
        selectedSort: sortOpt,
        showEggType: sortOpt === 'eggs',
        eggTypeChoices,
        expired: false,
        guildAvatarUrl
      });

      if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
        await interaction.update({ components });
        return;
      }

      await safeReply(interaction, { components, flags: MessageFlags.IsComponentsV2, ephemeral: cmd.ephemeral === true }, { loggerName: 'command:leaderboard' });
      const { collector, message: msg } = await createInteractionCollector(interaction, { components, time: 60_000, ephemeral: cmd.ephemeral === true, edit: true, collectorOptions: { componentType: 3 } });
      if (!collector) {
        try { require('../../utils/logger').get('command:leaderboard').warn('Failed to attach global leaderboard collector'); } catch (le) { try { fallbackLogger.warn('Failed to attach global leaderboard collector', le && (le.stack || le)); } catch (ignored) {} }
        return;
      }
      collector.on('collect', async i => {
        if (i.customId === 'leaderboard-sort') {
          const newSort = i.values[0];
          i.options = { getString: () => newSort, getSubcommand: () => 'global' };
          await module.exports.executeInteraction(i);
        } else if (i.customId === 'leaderboard-eggtype') {
          const newSort = i.values[0];
          i.options = { getString: () => newSort, getSubcommand: () => 'global' };
          await module.exports.executeInteraction(i);
        }
      });
      collector.on('end', async () => {
        try {
          if (msg) {
            await msg.edit({
              components: buildLeaderboardV2Components({
                title: 'Leaderboard',
                description: desc || 'No server data.',
                footer,
                sortChoices,
                selectedSort: sortOpt,
                showEggType: sortOpt === 'eggs',
                eggTypeChoices,
                expired: true,
                guildAvatarUrl
              })
            });
          }
        } catch (e) { try { require('../../utils/logger').get('command:leaderboard').warn('Failed finalizing global leaderboard view after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed finalizing global leaderboard view after collector end', le && (le.stack || le)); } catch (ignored) {} } }
      });
      return;
    }

    // Build per-user leaderboard data for the server
    let leaderboard = [];
    for (const user of rows) {
      const data = user.data || {};
      const guildData = data.guilds && data.guilds[guildId];
      
      // Skip users who have no data in this guild
      if (!guildData) continue;
      
      const eggs = guildData.eggs || {};
      const eggsTotal = Object.values(eggs).reduce((a, b) => a + b, 0);
      
      // Skip users with 0 eggs in this guild
      if (eggsTotal === 0) continue;
      
      const stats = guildData.stats || {};
      let entry = {
        id: user.discord_id,
        eggsTotal,
        eggs,
        fastest: stats.catchTimes && stats.catchTimes.length ? Math.min(...stats.catchTimes) : null,
        slowest: stats.catchTimes && stats.catchTimes.length ? Math.max(...stats.catchTimes) : null
      };
      leaderboard.push(entry);
    }
    // Sorting
    if (sort === 'eggs') {
      leaderboard.sort((a, b) => b.eggsTotal - a.eggsTotal);
    } else if (sort === 'fastest') {
      leaderboard = leaderboard.filter(e => e.fastest !== null);
      leaderboard.sort((a, b) => a.fastest - b.fastest);
    } else if (sort === 'slowest') {
      leaderboard = leaderboard.filter(e => e.slowest !== null);
      leaderboard.sort((a, b) => b.slowest - a.slowest);
    } else if (sort === 'rarity') {
      // Sum rarity*count for each user
      leaderboard.forEach(entry => {
        entry.rarityScore = 0;
        for (const type of eggTypes) {
          entry.rarityScore += (entry.eggs[type.id] || 0) * (type.rarity || 1);
        }
      });
      leaderboard.sort((a, b) => b.rarityScore - a.rarityScore);
    } else if (sort.startsWith('eggtype_')) {
      const type = sort.replace('eggtype_', '');
      leaderboard.sort((a, b) => (b.eggs[type] || 0) - (a.eggs[type] || 0));
    }
    // Top 10
    leaderboard = leaderboard.slice(0, 10);
    // Format output as embed
    let desc = '';
    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      let userTag = `<@${entry.id}>`;
      if (sort === 'eggs') {
        desc += `#${i + 1} ${userTag} — **${entry.eggsTotal} eggs**\n`;
      } else if (sort === 'fastest') {
        desc += `#${i + 1} ${userTag} — **${(entry.fastest / 1000).toFixed(2)}s**\n`;
      } else if (sort === 'slowest') {
        desc += `#${i + 1} ${userTag} — **${(entry.slowest / 1000 / 3600).toFixed(2)}h**\n`;
      } else if (sort === 'rarity') {
        desc += `#${i + 1} ${userTag} — **${entry.rarityScore} rarity**\n`;
      } else if (sort.startsWith('eggtype_')) {
        const type = sort.replace('eggtype_', '');
        const eggType = eggTypes.find(e => e.id === type);
        desc += `#${i + 1} ${userTag} — ${eggType.emoji} **${entry.eggs[type] || 0}**\n`;
      }
    }
     const sortChoices = [
       { label: 'Total Eggs', value: 'eggs' },
       { label: 'Fastest Catch', value: 'fastest' },
       { label: 'Slowest Catch', value: 'slowest' },
       { label: 'Egg Rarity', value: 'rarity' }
     ];
    const eggTypeChoices = eggTypes.map(e => ({
      label: `${e.name} Eggs`.length > 25 ? `${e.name} Eggs`.slice(0, 22) + '...' : `${e.name} Eggs`,
      value: `eggtype_${e.id}`.length > 25 ? `eggtype_${e.id}`.slice(0, 22) + '...' : `eggtype_${e.id}`
    }));
    const footer = `Sorted by: ${sortChoices.concat(eggTypeChoices).find(c => c.value === sort)?.label || sort}`;
    const guildAvatarUrl = interaction.guild && typeof interaction.guild.iconURL === 'function' ? interaction.guild.iconURL({ size: 256 }) : null;
    const components = buildLeaderboardV2Components({
      title: 'Leaderboard',
      description: desc || 'No data.',
      footer,
      sortChoices,
      selectedSort: sort,
      showEggType: sort === 'eggs',
      eggTypeChoices,
      expired: false,
      guildAvatarUrl
    });

    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
      await interaction.update({ components });
    } else {
      await safeReply(interaction, { components, flags: MessageFlags.IsComponentsV2, ephemeral: cmd.ephemeral === true }, { loggerName: 'command:leaderboard' });
      // Collector for sort menu
      const { collector, message: msg } = await createInteractionCollector(interaction, { components, time: 60_000, ephemeral: cmd.ephemeral === true, edit: true, collectorOptions: { componentType: 3 } });
      if (!collector) {
        try { require('../../utils/logger').get('command:leaderboard').warn('Failed to attach leaderboard collector'); } catch (le) { try { fallbackLogger.warn('Failed to attach leaderboard collector', le && (le.stack || le)); } catch (ignored) {} }
        return;
      }
      collector.on('collect', async i => {
        if (i.customId === 'leaderboard-sort') {
          const newSort = i.values[0];
          i.options = { getString: () => newSort };
          await module.exports.executeInteraction(i);
        } else if (i.customId === 'leaderboard-eggtype') {
          const newSort = i.values[0];
          i.options = { getString: () => newSort };
          await module.exports.executeInteraction(i);
        }
      });
      collector.on('end', async () => {
        try {
          if (msg) {
            await msg.edit({
              components: buildLeaderboardV2Components({
                title: 'Leaderboard',
                description: desc || 'No data.',
                footer,
                sortChoices,
                selectedSort: sort,
                showEggType: false,
                eggTypeChoices,
                expired: true,
                guildAvatarUrl
              })
            });
          }
        } catch (e) { try { logger && logger.warn && logger.warn('Failed finalizing leaderboard view after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard finalization failure', le && (le.stack || le)); } catch (ignored) {} } }
      });
    }
  }
};
