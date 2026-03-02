const { getCommandConfig } = require('../../utils/commandsConfig');
const links = require('../../../config/links.json');

const cmd = getCommandConfig('support-server') || {
  name: 'support-server',
  description: 'Get the support server invite link.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    
    const supportLink = links?.community?.support;
    
    if (!supportLink) {
      await safeReply(interaction, { content: 'Support server link is not configured.', ephemeral: true }, { loggerName: 'command:support-server' });
      return;
    }
    
    const row = {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: 'Join Support Server',
          url: supportLink
        }
      ]
    };
    
    await safeReply(interaction, { 
      content: '🆘 **Need help with Xeno Bot?**\nJoin our support server to get assistance, report bugs, or share feedback!', 
      components: [row],
      ephemeral: false 
    }, { loggerName: 'command:support-server' });
  }
};
