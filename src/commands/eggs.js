const { EmbedBuilder } = require('discord.js');
const { getCommandConfig } = require('../utils/commandsConfig');
const userModel = require('../models/user');
const hatchManager = require('../hatchManager');
const eggTypes = require('../../config/eggTypes.json');

const cmd = getCommandConfig('eggs') || { name: 'eggs', description: 'Manage your eggs' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'sell',
        description: 'Sell an egg for royal jelly',
        options: [
          { type: 3, name: 'egg', description: 'Egg type id', required: true },
          { type: 4, name: 'amount', description: 'Amount to sell', required: false }
        ]
      },
      {
        type: 1, // SUB_COMMAND
        name: 'hatch',
        description: 'Start hatching an egg',
        options: [
          { type: 3, name: 'egg', description: 'Egg type id', required: true },
          { type: 4, name: 'time', description: 'Hatch time in seconds', required: false }
        ]
      }
    ]
  },
  async autocomplete(interaction) {
    try {
      const autocomplete = require('../utils/autocomplete');
      const discordId = interaction.user.id;
      const guildId = interaction.guildId;
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
      return autocomplete(interaction, items, { map: it => ({ name: it.name, value: it.id }), max: 25 });
    } catch (e) {
      try { await interaction.respond([]); } catch {}
    }
  },

  async executeInteraction(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const discordId = interaction.user.id;
    try {
      if (sub === 'sell') {
        await interaction.deferReply({ ephemeral: true });
        const eggId = interaction.options.getString('egg');
        const amount = interaction.options.getInteger('amount') || 1;
        const eggConfig = eggTypes.find(e => e.id === eggId);
        if (!eggConfig) {
          await interaction.editReply({ content: 'Unknown egg type.' });
          return;
        }
        try {
          await userModel.removeEggsForGuild(discordId, guildId, eggId, amount);
          // compute sell price (default: half of configured price)
          const sellPrice = Math.max(0, Math.floor((Number(eggConfig.price || 0) / 2)));
          const total = sellPrice * Number(amount);
          const newBal = await userModel.modifyCurrencyForGuild(discordId, guildId, 'royal_jelly', total);
          await interaction.editReply({ content: `Sold ${amount} x ${eggConfig.name} for ${total} royal jelly. New balance: ${newBal}.` });
        } catch (e) {
          await interaction.editReply({ content: `Failed to sell eggs: ${e.message}` });
        }
        return;
      }
      if (sub === 'hatch') {
        await interaction.deferReply({ ephemeral: true });
        const eggId = interaction.options.getString('egg');
        const timeSec = interaction.options.getInteger('time') || 60;
        const eggConfig = eggTypes.find(e => e.id === eggId);
        if (!eggConfig) {
          await interaction.editReply({ content: 'Unknown egg type.' });
          return;
        }
        try {
          const h = await hatchManager.startHatch(discordId, guildId, eggId, Number(timeSec) * 1000);
          await interaction.editReply({ content: `Started hatching ${eggConfig.name}. Hatch id: ${h.id}. It will finish in ${timeSec}s.` });
        } catch (e) {
          await interaction.editReply({ content: `Failed to start hatch: ${e.message}` });
        }
        return;
      }
    } catch (err) {
      try { await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }); } catch {}
    }
  }
};
