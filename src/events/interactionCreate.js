const logger = require('../utils/logger').get('interactionCreate');
const { PermissionsBitField } = require('discord.js');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      // Handle autocomplete interactions separately
      if (interaction.isAutocomplete && interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
          if (typeof command.autocomplete === 'function') {
            await command.autocomplete(interaction);
          }
        } catch (e) {
          logger.warn('Autocomplete handler failed', { command: interaction.commandName, error: e && (e.stack || e) });
        }
        return;
      }
      if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        logger.info('Interaction command received', { command: interaction.commandName, user: interaction.user?.id });

        // Permission guard: commands can specify `requiredPermissions: ['ManageGuild']` or similar
        try {
          const required = command.requiredPermissions || command.permissions;
          if (required && interaction.member) {
            const perms = Array.isArray(required) ? required : [required];
            const missing = perms.some(p => !(interaction.memberPermissions && interaction.memberPermissions.has(PermissionsBitField.Flags[p])));
            if (missing) {
              try {
                await interaction.reply({ content: 'You do not have permission to run this command.', ephemeral: true });
              } catch {}
              return;
            }
          }
        } catch (permErr) {
          logger.warn('Permission check failed', { error: permErr && (permErr.stack || permErr) });
        }

        const baseLogger = require('../utils/logger');
        try {
          if (baseLogger && baseLogger.sentry) {
            try {
              baseLogger.sentry.addBreadcrumb({
                message: 'command.execute.start',
                category: 'command',
                data: { command: interaction.commandName, user: interaction.user?.id, guild: interaction.guildId, options: interaction.options?.data }
              });
              if (baseLogger.sentry.setTag) baseLogger.sentry.setTag('command', interaction.commandName);
            } catch {}
          }
          if (command.executeInteraction) await command.executeInteraction(interaction);
          if (baseLogger && baseLogger.sentry) {
            try {
              baseLogger.sentry.addBreadcrumb({ message: 'command.execute.finish', category: 'command', data: { command: interaction.commandName } });
            } catch {}
          }
        } finally {
          // noop; outer catch will handle errors and capture
        }
      }
    } catch (err) {
      // Enhanced diagnostics: include interaction metadata to diagnose expired/unknown interaction errors
      const meta = {
        id: interaction?.id,
        command: interaction?.commandName,
        user: interaction?.user?.id,
        guild: interaction?.guildId,
        createdTimestamp: interaction?.createdTimestamp,
        replied: Boolean(interaction?.replied),
        deferred: Boolean(interaction?.deferred),
        type: interaction?.type
      };
      logger.error('Error handling interaction:', { error: err.stack || err, ...meta });
      try {
        const baseLogger = require('../utils/logger');
        if (baseLogger && baseLogger.sentry) baseLogger.sentry.captureException(err);
      } catch (captureErr) {
        logger.warn('Failed to capture exception to Sentry', { error: captureErr && (captureErr.stack || captureErr) });
      }
      // If the interaction is old, don't try to reply (token likely expired)
      try {
        const ageMs = Date.now() - (interaction?.createdTimestamp || Date.now());
        if (ageMs > 10000) {
          logger.warn('Interaction too old to reply to, skipping error reply', { ageMs, ...meta });
          return;
        }
        if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        else await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
      } catch (replyErr) {
        logger.error('Failed to send error reply for interaction', { error: replyErr.stack || replyErr, ageMs: Date.now() - (interaction?.createdTimestamp || Date.now()), ...meta });
      }
    }
  }
};
