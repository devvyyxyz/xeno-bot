const { getCommandConfig } = require('../utils/commandsConfig');
const links = require('../../config/links.json');

const cmd = getCommandConfig('wiki') || {
  name: 'wiki',
  description: 'Get the bot wiki link.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    await interaction.reply({ content: `Wiki: ${links.wiki}`, ephemeral: false });
  }
};
