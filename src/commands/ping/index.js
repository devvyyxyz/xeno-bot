const { getCommandConfig } = require('../../utils/commandsConfig');
const cmd = getCommandConfig('ping') || { name: 'ping', description: 'Replies with Pong!' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    await safeReply(interaction, { content: 'Pong!', ephemeral: true }, { loggerName: 'command:ping' });
  },
  // text-mode handler removed; use slash command
};
