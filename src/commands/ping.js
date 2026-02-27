const { getCommandConfig } = require('../utils/commandsConfig');
const cmd = getCommandConfig('ping') || { name: 'ping', description: 'Replies with Pong!' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    await interaction.reply({ content: 'Pong!', flags: 64 });
  },
  // text-mode handler removed; use slash command
};
