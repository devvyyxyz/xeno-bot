const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { getCommandConfig } = require('../utils/commandsConfig');
const shopConfig = require('../../config/shop.json');
const userModel = require('../models/user');

const cmdCfg = getCommandConfig('item') || { name: 'item', description: 'Manage and use items' };

function findItem(itemId) {
  return (shopConfig.items || []).find(i => i.id === itemId || i.name.toLowerCase() === String(itemId).toLowerCase());
}

module.exports = {
  name: 'item',
  description: 'Use or inspect items',
  data: {
    name: 'item',
    description: 'Item utilities',
    options: [
      { // use
        type: 1,
        name: 'use',
        description: 'Use an item',
        options: [
          { type: 3, name: 'item_id', description: 'Item id', required: true },
          { type: 3, name: 'target', description: 'Target id (optional)', required: false }
        ]
      },
      { // info
        type: 1,
        name: 'info',
        description: 'Get item info',
        options: [ { type: 3, name: 'item_id', description: 'Item id', required: true } ]
      },
      { // combine
        type: 1,
        name: 'combine',
        description: 'Combine two items',
        options: [ { type: 3, name: 'item1', description: 'First item id', required: true }, { type: 3, name: 'item2', description: 'Second item id', required: true } ]
      }
    ]
  },

  async executeInteraction(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = String(interaction.user.id);
    if (sub === 'info') {
      const itemId = interaction.options.getString('item_id');
      const item = findItem(itemId);
      if (!item) return interaction.reply({ content: 'Item not found.', ephemeral: true });
      const embed = new EmbedBuilder().setTitle(item.name).setDescription(item.description || '').addFields({ name: 'Price', value: String(item.price || '—') }, { name: 'Rarity', value: String(item.rarity || 'common') }).setColor(require('../utils/commandsConfig').getCommandsObject().colour || '#bab25d');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'use') {
      await interaction.deferReply({ ephemeral: true });
      const itemId = interaction.options.getString('item_id');
      const target = interaction.options.getString('target');
      const item = findItem(itemId);
      if (!item) return interaction.editReply({ content: 'Item not found.' });
      try {
        const currentQty = await userModel.getUserByDiscordId(userId).then(u => { if (!u) return 0; const g = (u.data && u.data.guilds && u.data.guilds[guildId]) || {}; return Number((g.items && g.items[item.id]) || 0); });
        if (!currentQty || currentQty <= 0) return interaction.editReply({ content: `You don't have any ${item.name}.` });
        // consume one
        await userModel.removeItemForGuild(userId, guildId, item.id, 1);
        // Apply basic effects by setting flags in user data where applicable
        const user = await userModel.getUserByDiscordId(userId);
        const data = user.data || {};
        data.guilds = data.guilds || {};
        data.guilds[guildId] = data.guilds[guildId] || {};
        data.guilds[guildId].effects = data.guilds[guildId].effects || {};
        const now = Date.now();
        switch (item.id) {
          case 'incubation_accelerator':
            // mark single egg accelerator for short duration
            data.guilds[guildId].effects.incubation_accelerator = { applied_at: now, multiplier: 0.5, expires_at: now + 1000 * 60 * 60 }; // 1 hour
            break;
          case 'jelly_extractor':
            data.guilds[guildId].effects.jelly_extractor = { applied_at: now, multiplier: 2, expires_at: now + 1000 * 60 * 60 * 2 }; // 2 hours
            break;
          case 'defensive_pheromones':
            data.guilds[guildId].effects.defensive_pheromones = { applied_at: now, expires_at: now + 1000 * 60 * 60 }; // 1 hour
            break;
          case 'mutation_stabilizer':
            data.guilds[guildId].effects.mutation_stabilizer = { applied_at: now, uses: 3 }; // 3 uses
            break;
          case 'golden_gen':
            // mark next hatch to have golden chance
            data.guilds[guildId].effects.golden_next = { applied_at: now, expires_at: now + 1000 * 60 * 60 * 24 }; // 24h
            break;
          case 'pathogen_spores':
            data.guilds[guildId].effects.pathogen_spores = { applied_at: now, uses: 1 };
            break;
          case 'pathogen_liquid':
            data.guilds[guildId].effects.pathogen_liquid = { applied_at: now, applied_by: userId };
            break;
          case 'cyborg_parts':
            data.guilds[guildId].effects.cyborg_parts = { applied_at: now, uses: 1 };
            break;
          default:
            break;
        }
        await userModel.updateUserDataRawById(user.id, data);
        return interaction.editReply({ content: `Used one ${item.name}. Effect applied.` });
      } catch (e) {
        return interaction.editReply({ content: `Failed to use item: ${e && e.message ? e.message : e}` });
      }
    }

    if (sub === 'combine') {
      await interaction.deferReply({ ephemeral: true });
      const item1 = interaction.options.getString('item1');
      const item2 = interaction.options.getString('item2');
      const a = findItem(item1);
      const b = findItem(item2);
      if (!a || !b) return interaction.editReply({ content: 'One or both items not found.' });
      // simple combine rules: two golden_gen -> rare token, else not implemented
      if (a.id === 'golden_gen' && b.id === 'golden_gen') {
        try {
          const user = await userModel.getUserByDiscordId(userId);
          const g = (user.data && user.data.guilds && user.data.guilds[guildId]) || {};
          const qtyA = Number((g.items && g.items[a.id]) || 0);
          const qtyB = Number((g.items && g.items[b.id]) || 0);
          if (qtyA < 1 || qtyB < 1) return interaction.editReply({ content: 'Insufficient items to combine.' });
          await userModel.removeItemForGuild(userId, guildId, a.id, 1);
          await userModel.removeItemForGuild(userId, guildId, b.id, 1);
          // give a new item: golden_fragment (virtual)
          await userModel.addItemForGuild(userId, guildId, 'golden_fragment', 1);
          return interaction.editReply({ content: 'Combined two Golden Gen into Golden Fragment.' });
        } catch (e) {
          return interaction.editReply({ content: `Combine failed: ${e && e.message ? e.message : e}` });
        }
      }
      return interaction.editReply({ content: 'Combine recipe not implemented for those items.' });
    }
    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
};
