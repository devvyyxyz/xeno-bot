const { getCommandConfig } = require('../utils/commandsConfig');
const userModel = require('../models/user');
const eggTypes = require('../../config/eggTypes.json');
const fallbackLogger = require('../utils/fallbackLogger');
const createInteractionCollector = require('../utils/collectorHelper');

const cmd = getCommandConfig('leaderboard') || {
  name: 'leaderboard',
  description: 'View the top collectors and catchers.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      {
        name: 'sort',
        description: 'Sort by',
        type: 3, // STRING
        required: false,
        autocomplete: true
      }
    ]
  },
   async autocomplete(interaction) {
     const eggTypes = require('../../config/eggTypes.json');
     const autocomplete = require('../utils/autocomplete');
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
    const sort = interaction.options.getString('sort') || 'eggs';
    if (!(interaction.isStringSelectMenu && interaction.isStringSelectMenu())) {
      await interaction.deferReply({ ephemeral: cmd.ephemeral === true });
    }
    // Get all users in DB
    const baseLogger = require('../utils/logger');
    if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.getAllUsers.start', category: 'db' }); } catch (e) { try { logger && logger.warn && logger.warn('Failed to add sentry breadcrumb (db.getAllUsers.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard breadcrumb (db.getAllUsers.start)', le && (le.stack || le)); } catch (ignored) {} } } }
    const rows = await userModel.getAllUsers();
    if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.getAllUsers.finish', category: 'db', data: { count: rows.length } }); } catch (e) { try { logger && logger.warn && logger.warn('Failed to add sentry breadcrumb (db.getAllUsers.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard breadcrumb (db.getAllUsers.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
    const guildId = interaction.guildId;
    // Build leaderboard data
    let leaderboard = [];
    for (const user of rows) {
      const data = user.data || {};
      const eggs = (data.guilds && data.guilds[guildId]?.eggs) || {};
      const stats = data.stats || {};
      let entry = {
        id: user.discord_id,
        eggsTotal: Object.values(eggs).reduce((a, b) => a + b, 0),
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
    const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
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
    const embed = new EmbedBuilder()
      .setTitle('🏆 Leaderboard')
      .setDescription(desc || 'No data.')
      .setColor(cmd.embedColor || 0x00b2ff)
      .setFooter({ text: `Sorted by: ${sortChoices.concat(eggTypeChoices).find(c => c.value === sort)?.label || sort}` });

    const select = new StringSelectMenuBuilder()
      .setCustomId('leaderboard-sort')
      .setPlaceholder('Sort by...')
      .addOptions(sortChoices.slice(0, 25).map(opt => ({ label: opt.label, value: opt.value, default: opt.value === sort })));

    const components = [new ActionRowBuilder().addComponents(select)];
    // Only show egg type select on total eggs leaderboard
    if (sort === 'eggs') {
      const eggTypeSelect = new StringSelectMenuBuilder()
        .setCustomId('leaderboard-eggtype')
        .setPlaceholder('Sort by egg type...')
        .addOptions(eggTypeChoices.slice(0, 25).map(opt => ({ label: opt.label, value: opt.value })));
      components.push(new ActionRowBuilder().addComponents(eggTypeSelect));
    }

    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
      await interaction.update({ embeds: [embed], components });
    } else {
      await interaction.editReply({ embeds: [embed], components });
      // Collector for sort menu
      const { collector, message: msg } = await createInteractionCollector(interaction, { embeds: [embed], components, time: 60_000, ephemeral: cmd.ephemeral === true, edit: true, collectorOptions: { componentType: 3 } });
      if (!collector) {
        try { require('../utils/logger').get('command:leaderboard').warn('Failed to attach leaderboard collector'); } catch (le) { try { fallbackLogger.warn('Failed to attach leaderboard collector', le && (le.stack || le)); } catch (ignored) {} }
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
        try { await msg.edit({ components: [] }); } catch (e) { try { logger && logger.warn && logger.warn('Failed clearing leaderboard components after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging leaderboard component clear failure', le && (le.stack || le)); } catch (ignored) {} } }
      });
    }
  }
};
