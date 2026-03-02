const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { getCommandConfig } = require('../../utils/commandsConfig');
const safeReply = require('../../utils/safeReply');
const { buildNoticeV2Payload } = require('../../utils/componentsV2');
const guildCreateHandler = require('../../events/guildCreate');

const cmd = getCommandConfig('joinnotice') || {
  name: 'joinnotice',
  description: 'Admin: trigger the new-server webhook notice for this server'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: ['ManageGuild'],
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description),

  async executeInteraction(interaction) {
    try {
      if (!interaction.guild) {
        await safeReply(interaction, {
          ...buildNoticeV2Payload({ message: 'This command can only be used inside a server.', tone: 'requirement' }),
          ephemeral: true
        }, { loggerName: 'command:joinnotice' });
        return;
      }

      const result = await guildCreateHandler.sendGuildJoinV2Webhook({
        guild: interaction.guild,
        client: interaction.client
      });

      if (result && result.sent) {
        await safeReply(interaction, {
          ...buildNoticeV2Payload({
            title: '✅ Join Notice Sent',
            message: `Webhook message sent for **${interaction.guild.name}** using mode: \`${result.mode || 'unknown'}\`.`,
            tone: 'info'
          }),
          ephemeral: true
        }, { loggerName: 'command:joinnotice' });
        return;
      }

      await safeReply(interaction, {
        ...buildNoticeV2Payload({
          title: '⚠️ Join Notice Not Sent',
          message: `Webhook send failed${result && result.reason ? `: ${result.reason}` : '.'}${result && result.error ? `\n\nDetails: ${result.error}` : ''}`,
          tone: 'error'
        }),
        ephemeral: true
      }, { loggerName: 'command:joinnotice' });
    } catch (err) {
      await safeReply(interaction, {
        ...buildNoticeV2Payload({
          message: `Failed to send join notice: ${err && err.message ? err.message : 'Unknown error'}`,
          tone: 'error'
        }),
        ephemeral: true
      }, { loggerName: 'command:joinnotice' });
    }
  }
};
