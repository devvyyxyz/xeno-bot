const { getCommandConfig } = require('../../utils/commandsConfig');
const links = require('../../../config/links.json');

const cmd = getCommandConfig('invite') || {
  name: 'invite',
  description: 'Get the bot invite link.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    
    const inviteLink = links?.general?.invite || links?.invite;
    
    if (!inviteLink) {
      await safeReply(interaction, { content: 'Invite link is not configured.', ephemeral: true }, { loggerName: 'command:invite' });
      return;
    }
    
    const row = {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: 'Invite Bot',
          url: inviteLink
        }
      ]
    };
    
    await safeReply(interaction, { 
      content: '✨ **Invite Xeno Bot to your server!**\nClick the button below to add the bot with all required permissions.', 
      components: [row],
      ephemeral: false 
    }, { loggerName: 'command:invite' });
  }
};
