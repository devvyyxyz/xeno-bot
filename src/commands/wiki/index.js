const { getCommandConfig } = require('../../utils/commandsConfig');
const links = require('../../../config/links.json');
const pageLinks = links.general || links;

const cmd = getCommandConfig('wiki') || {
  name: 'wiki',
  description: 'Get the bot wiki link.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    await safeReply(interaction, { content: `Wiki: ${pageLinks.wiki}`, ephemeral: false }, { loggerName: 'command:wiki' });
  }
};
