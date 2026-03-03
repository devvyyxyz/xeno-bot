const { ChannelType, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const config = require('../../config/config.json');
const logger = require('../utils/logger').get('event:threadCreate');

module.exports = {
  name: 'threadCreate',
  async execute(thread, newlyCreated) {
    try {
      if (!newlyCreated) return;

      const forumChannelId = String(config?.bugReports?.forumChannelId || '').trim();
      if (!forumChannelId) return;

      if (!thread) return;
      if (thread.parentId !== forumChannelId) return;
      if (thread.type !== ChannelType.PublicThread && thread.type !== ChannelType.PrivateThread) return;

      const introMessage =
        String(config?.bugReports?.introMessage || '').trim() ||
        'Thanks for opening a bug report. When fixed, click **Mark Resolved**.';

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(introMessage)
      );
      container.addActionRowComponents({
        type: 1,
        components: [
          {
            type: 2,
            custom_id: 'bugreport-mark-resolved',
            label: 'Mark Resolved',
            style: 3
          }
        ]
      });

      await thread.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    } catch (err) {
      logger.warn('Failed handling threadCreate for bug reports', { error: err && (err.stack || err) });
    }
  }
};
