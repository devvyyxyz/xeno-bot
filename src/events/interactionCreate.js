const logger = require('../utils/logger').get('interactionCreate');
const safeReply = require('../utils/safeReply');
const fallbackLogger = require('../utils/fallbackLogger');
const { PermissionsBitField } = require('discord.js');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      // Handle autocomplete interactions separately
      if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
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
      if (typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        logger.info('Interaction command received', { command: interaction.commandName, user: interaction.user?.id });

          // News reminder: if there's a newer article than user's last seen, flag interaction so replies can include a reminder.
          try {
            const articlesUtil = require('../utils/articles');
            const { getLatestArticleInfo } = articlesUtil;
            const latestInfo = getLatestArticleInfo();
            if (latestInfo && latestInfo.latest) {
              // don't set reminder when the user is running the news command itself
              if (interaction.commandName !== 'news') {
                // perform DB lookup asynchronously and do not await so we don't block the interaction handling
                try {
                  const userModel = require('../models/user');
                  userModel.getUserByDiscordId(interaction.user.id).then(u => {
                    try {
                      const lastSeen = u?.data?.meta?.lastReadArticleAt || 0;
                      if (Number(latestInfo.latest) > Number(lastSeen)) {
                        interaction._newsReminder = true;
                        interaction._newsLatest = latestInfo.latest;
                        interaction._newsTitle = latestInfo.title || null;
                      }
                    } catch (inner) { /* ignore */ }
                  }).catch(() => {});
                } catch (e2) { /* ignore */ }
              }
            }
          } catch (e) {
            try { logger.warn('Failed checking latest articles for reminder', { error: e && (e.stack || e) }); } catch (_) {}
          }

        // Permission guard: commands can specify `requiredPermissions: ['ManageGuild']` or similar
        try {
          const required = command.requiredPermissions || command.permissions;
          if (required && interaction.member) {
            const perms = Array.isArray(required) ? required : [required];
            const missing = perms.some(p => !(interaction.memberPermissions && interaction.memberPermissions.has(PermissionsBitField.Flags[p])));
            if (missing) {
              try {
                await safeReply(interaction, { content: 'You do not have permission to run this command.', ephemeral: true }, { loggerName: 'interactionCreate' });
              } catch (e) {
                logger.warn('Failed sending permission denied message', { error: e && (e.stack || e) });
              }
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
            } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (command.execute.start)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (command.execute.start)', le && (le.stack || le)); } }
          }
          if (command.executeInteraction) {
            try {
              await command.executeInteraction(interaction);
            } catch (cmdErr) {
              // Let outer error handler catch it by rethrowing
              throw cmdErr;
            }
          }
          if (baseLogger && baseLogger.sentry) {
            try {
              baseLogger.sentry.addBreadcrumb({ message: 'command.execute.finish', category: 'command', data: { command: interaction.commandName } });
            } catch (e) { try { logger.warn('Failed to add sentry breadcrumb (command.execute.finish)', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging breadcrumb failure (command.execute.finish)', le && (le.stack || le)); } }
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
      logger.error('Error handling interaction', { error: err && (err.stack || err), ...meta });
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
        
        const links = require('../../config/links.json');
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const components = [];
        
        if (links?.community?.support) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('Join Support Server')
              .setStyle(ButtonStyle.Link)
              .setURL(links.community.support)
          );
          components.push(row);
        }
        
        await safeReply(interaction, { 
          content: '❌ Error\nThere was an error while executing this command!', 
          components, 
          ephemeral: true 
        }, { loggerName: 'interactionCreate' });
      } catch (replyErr) {
        logger.error('Failed to send error reply for interaction', { error: replyErr.stack || replyErr, ageMs: Date.now() - (interaction?.createdTimestamp || Date.now()), ...meta });
      }
    }
  }
};
