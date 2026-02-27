const logger = require('../utils/logger').get('messageCreate');
const spawnManager = require('../spawnManager');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;
    try {
      const handled = await spawnManager.handleMessage(message);
      if (handled) return;
    } catch (err) {
      logger.error('Spawn manager message handling failed', { error: err.stack || err });
    }
    const prefix = client.config?.prefix || '!';
    if (!message.content.startsWith(prefix)) return;
    logger.debug && logger.debug('Message received', { user: message.author.id, channel: message.channel.id });
    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const command = client.commands.get(commandName);
    if (!command) return;
    if (!command.executeMessage) {
      logger.debug && logger.debug('Message-mode command not available (slash-only)', { command: commandName });
      return;
    }
    try {
      logger.info('Executing message command', { command: commandName, user: message.author.id });
      const baseLogger = require('../utils/logger');
      if (baseLogger && baseLogger.sentry) {
        try {
          baseLogger.sentry.addBreadcrumb({ message: 'command.execute.start', category: 'command', data: { command: commandName, user: message.author.id, channel: message.channel.id } });
          if (baseLogger.sentry.setTag) baseLogger.sentry.setTag('command', commandName);
        } catch {}
      }
      await command.executeMessage(message, args);
      if (baseLogger && baseLogger.sentry) {
        try { baseLogger.sentry.addBreadcrumb({ message: 'command.execute.finish', category: 'command', data: { command: commandName } }); } catch {}
      }
    } catch (err) {
      logger.error('Error executing message command', { error: err.stack || err, command: commandName, user: message.author.id });
      try {
        const baseLogger = require('../utils/logger');
        if (baseLogger && baseLogger.sentry) baseLogger.sentry.captureException(err);
      } catch (captureErr) {
        logger.warn('Failed to capture exception to Sentry', { error: captureErr && (captureErr.stack || captureErr) });
      }
      try {
        await message.reply('There was an error executing that command.');
      } catch (replyErr) {
        logger.error('Failed to send error reply for message command', { error: replyErr.stack || replyErr });
      }
    }
  }
};
