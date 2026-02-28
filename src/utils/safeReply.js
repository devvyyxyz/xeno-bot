const baseLogger = require('./logger');
const fallbackLogger = require('./fallbackLogger');

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
        const title = interaction._newsTitle ? ` — ${interaction._newsTitle}` : '';
        const notice = `📢 New article posted${title}! Read it with /news\n\n`;
        if (payload.content) payload.content = notice + payload.content;
        else payload.content = notice;
      }
    } catch (e) { /* ignore reminder attach errors */ }

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
