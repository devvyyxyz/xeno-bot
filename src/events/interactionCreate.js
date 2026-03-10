const utils = require('../utils');
const logger = utils.logger.get('interactionCreate');
const safeReply = utils.safeReply;
const fallbackLogger = utils.fallbackLogger;
const { PermissionsBitField } = require('discord.js');
const config = require('../../config/config.json');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) { /* ignore */ void 0; }
    }
  } catch (e) { /* ignore */ void 0; }
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      // Handle modal submissions for devmenu blacklist/unblacklist
      if (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) {
        if (interaction.customId === 'devmenu-blacklist-modal' || interaction.customId === 'devmenu-unblacklist-modal') {
          const ownerId = resolveOwnerId();
          if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
            await safeReply(interaction, { content: 'This action is owner-only.', ephemeral: true }, { loggerName: 'interactionCreate' });
            return;
          }
          try {
            const guildInput = String(interaction.fields.getTextInputValue('guild_id') || '').trim();
            let guildId = guildInput;
            if (!guildId) {
              await safeReply(interaction, { content: 'No guild ID provided.', ephemeral: true }, { loggerName: 'interactionCreate' });
              return;
            }
            if (guildId.toLowerCase() === 'current') guildId = interaction.guildId || null;
            if (!guildId) {
              await safeReply(interaction, { content: 'No current guild context available; please provide a guild ID.', ephemeral: true }, { loggerName: 'interactionCreate' });
              return;
            }
            const lbModel = require('../models/leaderboardBlacklist');
            if (interaction.customId === 'devmenu-blacklist-modal') {
              const ok = await lbModel.add(guildId);
              await safeReply(interaction, { content: ok ? `✅ Guild ${guildId} added to global leaderboard blacklist.` : `❌ Failed to blacklist guild ${guildId}.`, ephemeral: true }, { loggerName: 'interactionCreate' });
              return;
            } else {
              const ok = await lbModel.remove(guildId);
              await safeReply(interaction, { content: ok ? `✅ Guild ${guildId} removed from global leaderboard blacklist.` : `❌ Failed to remove guild ${guildId} from blacklist.`, ephemeral: true }, { loggerName: 'interactionCreate' });
              return;
            }
          } catch (e) {
            logger.error('Failed processing devmenu modal submit', { error: e && (e.stack || e) });
            try { await safeReply(interaction, { content: `❌ Error: ${e && e.message ? e.message : 'Unknown error'}`, ephemeral: true }, { loggerName: 'interactionCreate' }); } catch (_) { /* ignore */ void 0; }
            return;
          }
        }
      }
      // Handle bug report resolve button
      if (typeof interaction.isButton === 'function' && interaction.isButton() && interaction.customId === 'bugreport-mark-resolved') {
        const forumChannelId = String(config?.bugReports?.forumChannelId || '').trim();
        const resolvedMessage = String(config?.bugReports?.resolvedMessage || '').trim() || '✅ This bug report has been marked as resolved and the post is now closed.';
        const channel = interaction.channel;
        if (!forumChannelId || !channel || !channel.isThread?.() || channel.parentId !== forumChannelId) {
          await safeReply(interaction, { content: 'This button can only be used in configured bug report posts.', ephemeral: true }, { loggerName: 'interactionCreate' });
          return;
        }

        const isThreadOwner = String(channel.ownerId || '') === String(interaction.user.id || '');
        let guildOwnerId = String(interaction.guild?.ownerId || '').trim();
        if (!guildOwnerId) {
          try {
            const fetchedGuild = await interaction.client.guilds.fetch(interaction.guildId);
            guildOwnerId = String(fetchedGuild?.ownerId || '').trim();
          } catch (_) { /* ignore */ void 0; }
        }
        const isGuildOwner = guildOwnerId && String(interaction.user.id || '') === guildOwnerId;

        if (!isThreadOwner && !isGuildOwner) {
          await safeReply(interaction, { content: 'Only the thread owner or server owner can mark this as resolved.', ephemeral: true }, { loggerName: 'interactionCreate' });
          return;
        }

        try {
          await channel.setLocked(true, `Resolved by ${interaction.user.tag}`);
        } catch (e) {
          logger.warn('Failed to lock bug report thread', { threadId: channel.id, error: e && (e.stack || e) });
        }
        try {
          await channel.setArchived(true, `Resolved by ${interaction.user.tag}`);
        } catch (e) {
          logger.warn('Failed to archive bug report thread', { threadId: channel.id, error: e && (e.stack || e) });
        }

        await safeReply(interaction, { content: resolvedMessage, ephemeral: true }, { loggerName: 'interactionCreate' });
        return;
      }

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
                // Check cache first to avoid DB lookup
                const newsReminderCache = require('../utils/newsReminderCache');
                const cachedData = newsReminderCache.get(interaction.user.id);

                if (cachedData) {
                  // Cache hit - use cached timestamp
                  if (Number(latestInfo.latest) > Number(cachedData.latestTimestamp)) {
                    interaction._newsReminder = true;
                    interaction._newsLatest = latestInfo.latest;
                    interaction._newsTitle = latestInfo.title || null;
                  }
                } else {
                  // Cache miss - fetch from DB and update cache
                  // perform DB lookup asynchronously and do not await so we don't block the interaction handling
                  try {
                    const userModel = require('../models/user');
                    userModel.getUserByDiscordId(interaction.user.id).then(u => {
                      try {
                        const lastSeen = u?.data?.meta?.lastReadArticleAt || 0;
                        // Update cache with the fetched timestamp
                        newsReminderCache.set(interaction.user.id, lastSeen);
                        if (Number(latestInfo.latest) > Number(lastSeen)) {
                          interaction._newsReminder = true;
                          interaction._newsLatest = latestInfo.latest;
                          interaction._newsTitle = latestInfo.title || null;
                        }
                      } catch (inner) { /* ignore */ void 0; }
                    }).catch(() => { /* ignore */ });
                    } catch (e2) { /* ignore */ void 0; }
                }
              }
            }
            } catch (e) {
            try { logger.warn('Failed checking latest articles for reminder', { error: e && (e.stack || e) }); } catch (_) { /* ignore */ void 0; }
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

        const baseLogger = utils.logger;
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
            await command.executeInteraction(interaction);
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
          const baseLogger = utils.logger;
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
        
        const replyOptions = { 
          content: '❌ Error\nThere was an error while executing this command!', 
          ephemeral: true 
        };
        
        if (links?.community?.support) {
          const row = {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'Join Support Server',
                url: links.community.support
              }
            ]
          };
          replyOptions.components = [row];
        }
        
        await safeReply(interaction, replyOptions, { loggerName: 'interactionCreate' });
      } catch (replyErr) {
        logger.error('Failed to send error reply for interaction', { error: replyErr.stack || replyErr, ageMs: Date.now() - (interaction?.createdTimestamp || Date.now()), ...meta });
      }
    }
  }
};
