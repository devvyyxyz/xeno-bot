const { getCommandConfig } = require('../../utils/commandsConfig');
const links = require('../../../config/links.json');

const cmd = getCommandConfig('suggest') || {
  name: 'suggest',
  description: 'Get the best place to send suggestions.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');

    const supportLink = links?.community?.support;

    if (!supportLink) {
      await safeReply(interaction, { content: 'Support server link is not configured.', ephemeral: true }, { loggerName: 'command:suggest' });
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
      content: '💡 Want to suggest a feature or improvement?\nPlease join our support server and post it in the suggestions forum so the team can track it properly.',
      components: [row],
      ephemeral: false
    }, { loggerName: 'command:suggest' });
  }
};
