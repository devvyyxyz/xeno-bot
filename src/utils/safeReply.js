const baseLogger = require('./logger');
const fallbackLogger = require('./fallbackLogger');
const { getCommandConfig } = require('./commandsConfig');

async function safeReply(interaction, payload = {}, opts = {}) {
  const logger = (baseLogger && baseLogger.get) ? baseLogger.get(opts.loggerName || 'utils:safeReply') : console;
  try {
    // If interaction already replied or deferred, prefer editReply
    if (interaction.replied || interaction.deferred) {
      try {
        return await interaction.editReply(payload);
      } catch (e) {
        // fallthrough to followUp
        try {
          if (typeof interaction.followUp === 'function') return await interaction.followUp(payload);
        } catch (e2) {
          logger && logger.warn && logger.warn('safeReply: editReply/followUp failed', { error: e2 && (e2.stack || e2) });
        }
      }
    }

    // If caller requested suppression of news reminder, skip. Otherwise prepend reminder to content if present on interaction.
    try {
      if (interaction && interaction._newsReminder && !payload.__suppressNewsReminder) {
        // Don't reveal the article title; just notify there's a new article.
        // Prefer a linked mention to the `/news` application command when available.
        let mention = '/news';
        try {
          let appCommands = null;
          if (interaction.guild) {
            appCommands = await interaction.guild.commands.fetch();
          }
          if (!appCommands && interaction.client && interaction.client.application) {
            appCommands = await interaction.client.application.commands.fetch();
          }
          if (appCommands) {
            const found = appCommands.find(c => c.name === 'news');
            if (found && found.id) mention = `</news:${found.id}>`;
          }
        } catch (e) { /* ignore fetch failures, fall back to plain text /news */ }

        const notice = `📢 New article posted! Read it with ${mention}\n\n`;
        if (payload.content) payload.content = notice + payload.content;
        else payload.content = notice;
      }
    } catch (e) { /* ignore reminder attach errors */ }

    // If caller didn't set ephemeral explicitly, try to infer from commands.json config (command or subcommand)
    try {
      if (payload.ephemeral === undefined && interaction && interaction.commandName) {
        let inferred = null;
        const cmdName = String(interaction.commandName || '').trim();
        let sub = null;
        try { sub = interaction.options && interaction.options.getSubcommand ? (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })() : null; } catch (e) { sub = null; }
        if (sub) {
          inferred = getCommandConfig(`${cmdName} ${sub}`) || getCommandConfig(`${cmdName}.${sub}`) || null;
        }
        if (!inferred) inferred = getCommandConfig(cmdName) || null;
        if (inferred && Object.prototype.hasOwnProperty.call(inferred, 'ephemeral')) payload.ephemeral = !!inferred.ephemeral;
      }
    } catch (e) { /* ignore config lookup failures */ }

    // Not replied yet — try reply
    try {
      return await interaction.reply(payload);
    } catch (e) {
      logger && logger.warn && logger.warn('safeReply: reply failed, attempting defer+edit', { error: e && (e.stack || e) });
      try {
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: payload.ephemeral || false });
        return await interaction.editReply(payload);
      } catch (e2) {
        try {
          if (typeof interaction.followUp === 'function') return await interaction.followUp(payload);
        } catch (e3) {
          logger && logger.error && logger.error('safeReply: all reply strategies failed', { error: e3 && (e3.stack || e3) });
        }
      }
    }
  } catch (finalErr) {
    try { logger && logger.error && logger.error('safeReply: unexpected error', { error: finalErr && (finalErr.stack || finalErr) }); } catch (e) { try { fallbackLogger.warn('safeReply: failed logging unexpected error', e && (e.stack || e)); } catch (ignored) {} }
  }
}

module.exports = safeReply;
