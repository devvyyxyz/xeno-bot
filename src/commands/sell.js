const { getCommandConfig } = require('../utils/commandsConfig');
const shopConfig = require('../../config/shop.json');
const userModel = require('../models/user');

const cmd = getCommandConfig('sell') || { name: 'sell', description: 'Sell an item for royal_jelly' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      {
        name: 'item',
        description: 'Item id to sell (autocomplete)',
        type: 3, // STRING
        required: true,
        autocomplete: true
      },
      {
        name: 'amount',
        description: 'Amount to sell',
        type: 4, // INTEGER
        required: false
      }
    ]
  },
  async autocomplete(interaction) {
    const autocomplete = require('../utils/autocomplete');
    const items = (shopConfig.items || []).filter(it => (it.sellable !== false));
    return autocomplete(interaction, items, { map: i => ({ name: `${i.name} — sells for ${i.sellPrice || 0}`, value: String(i.id) }), max: 25 });
  },
  async executeInteraction(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const itemId = interaction.options.getString('item');
    const amount = interaction.options.getInteger('amount') || 1;
    const guildId = interaction.guildId;
    const userId = String(interaction.user.id);
    const item = (shopConfig.items || []).find(i => i.id === itemId);
    if (!item) {
      await interaction.editReply({ content: 'Item not found.' });
      return;
    }
    if (item.sellable === false) {
      await interaction.editReply({ content: 'This item cannot be sold.' });
      return;
    }
    const sellPrice = Number(item.sellPrice || 0);
    if (!sellPrice || sellPrice <= 0) {
      await interaction.editReply({ content: 'This item has no sell price configured.' });
      return;
    }
    try {
      const user = await userModel.getUserByDiscordId(userId);
      const current = (user && user.data && user.data.guilds && user.data.guilds[guildId] && user.data.guilds[guildId].items && Number(user.data.guilds[guildId].items[itemId] || 0)) || 0;
      if (current < amount) {
        await interaction.editReply({ content: `You only have ${current} of ${item.name}.` });
        return;
      }
      // remove item then add currency
      await userModel.removeItemForGuild(userId, guildId, itemId, amount);
      const total = sellPrice * Number(amount);
      const newBal = await userModel.modifyCurrencyForGuild(userId, guildId, 'royal_jelly', total);
      await interaction.editReply({ content: `Sold ${amount} x ${item.name} for ${total} royal_jelly. New balance: ${newBal}.` });
    } catch (err) {
      await interaction.editReply({ content: `Failed to sell item: ${err && (err.message || err)}` });
    }
  }
};
