const { getCommandConfig } = require('../../utils/commandsConfig');
const {
  TextDisplayBuilder,
  SectionBuilder,
  ContainerBuilder,
  MessageFlags
} = require('discord.js');
const cmd = getCommandConfig('ping') || { name: 'ping', description: 'Replies with Pong!' };

function buildPingPayload(interaction, customId, includeButton = true, footerText = null) {
  const botLatency = Date.now() - Number(interaction.createdTimestamp || Date.now());
  // Try multiple ways to get API latency for Discord.js v14 compatibility
  const apiLatency = Number(
    interaction.client?.ws?.ping || 
    interaction.client?.ping || 
    interaction.client?.rest?.ping ||
    0
  );
  const header = new TextDisplayBuilder().setContent('## Pong!');
  const latency = new TextDisplayBuilder().setContent(`Bot: ${botLatency}ms • API: ${apiLatency}ms`);
  const footer = footerText ? new TextDisplayBuilder().setContent(`_${footerText}_`) : null;

  const container = new ContainerBuilder();
  if (includeButton) {
    container.addSectionComponents(
      new SectionBuilder()
        .setSuccessButtonAccessory((button) =>
          button
            .setCustomId(customId)
            .setLabel('Ping Again')
        )
        .addTextDisplayComponents(header, latency)
    );
  } else {
    container.addTextDisplayComponents(header, latency);
  }
  if (footer) container.addTextDisplayComponents(footer);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const logger = require('../../utils/logger').get('command:ping');
    const customId = `ping-refresh:${interaction.user.id}:${Date.now()}`;

    try {
      await interaction.deferReply({ ephemeral: cmd.ephemeral === true });
      await safeReply(interaction, buildPingPayload(interaction, customId), { loggerName: 'command:ping' });
    } catch (e) {
      logger.warn('Ping V2 payload failed, trying minimal V2 payload', { error: e && (e.stack || e) });
      try {
        await safeReply(interaction, {
          components: [new TextDisplayBuilder().setContent('Pong!')],
          flags: MessageFlags.IsComponentsV2
        }, { loggerName: 'command:ping' });
      } catch (e2) {
        logger.warn('Ping minimal V2 payload failed, falling back to plain text', { error: e2 && (e2.stack || e2) });
        await safeReply(interaction, { content: 'Pong!', ephemeral: true }, { loggerName: 'command:ping' });
      }
      return;
    }

    let message = null;
    try { message = await interaction.fetchReply(); } catch (_) { return; }
    if (!message || typeof message.createMessageComponentCollector !== 'function') return;
    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id && i.customId === customId,
      time: 120000
    });

    collector.on('collect', async i => {
      try {
        await i.update(buildPingPayload(i, customId));
      } catch (e) {
        logger.warn('Ping refresh update failed', { error: e && (e.stack || e) });
        try { await i.reply({ content: 'Failed to refresh ping.', ephemeral: true }); } catch (__) {}
      }
    });

    collector.on('end', async () => {
      try {
        await safeReply(interaction, buildPingPayload(interaction, customId, false, 'Ping refresh expired'), { loggerName: 'command:ping' });
      } catch (e) {
        logger.warn('Failed to finalize ping message on collector end', { error: e && (e.stack || e) });
      }
    });
  },
  // text-mode handler removed; use slash command
};
