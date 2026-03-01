const baseLogger = require('./logger');
const fallbackLogger = require('./fallbackLogger');
const { getCommandConfig } = require('./commandsConfig');
const { buildNoticeV2Payload, classifyNoticeTone } = require('./componentsV2');

function maybeBuildStyledNoticePayload(payload = {}, opts = {}) {
  try {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.components || payload.embeds || payload.files || payload.attachments) return null;
    if (payload.__skipNoticeStyle) return null;

    const content = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!content) return null;

    const explicitTone = payload.__noticeTone || opts.noticeTone || null;
    const tone = explicitTone || classifyNoticeTone(content);
    if (!tone) return null;

    const notice = buildNoticeV2Payload({
      title: payload.__noticeTitle || opts.noticeTitle || null,
      message: content,
      tone,
      footer: payload.__noticeFooter || opts.noticeFooter || null
    });

    const { content: _content, ...rest } = payload;
    return {
      ...rest,
      ...notice,
      __styledNotice: true
    };
  } catch (_) {
    return null;
  }
}

async function safeReply(interaction, payload = {}, opts = {}) {
  const logger = (baseLogger && baseLogger.get) ? baseLogger.get(opts.loggerName || 'utils:safeReply') : console;
  const originalPayload = payload && typeof payload === 'object' ? { ...payload } : payload;
  const styledPayload = maybeBuildStyledNoticePayload(payload, opts);
  const usingStyledPayload = !!styledPayload;
  if (usingStyledPayload) payload = styledPayload;
  try {
    // If interaction already replied or deferred, prefer editReply
    if (interaction.replied || interaction.deferred) {
      try {
        return await interaction.editReply(payload);
      } catch (e) {
        if (usingStyledPayload) {
          try {
            return await interaction.editReply(originalPayload);
          } catch (_) {}
        }
        // fallthrough to followUp
        try {
          if (typeof interaction.followUp === 'function') return await interaction.followUp(payload);
        } catch (e2) {
          if (usingStyledPayload) {
            try {
              if (typeof interaction.followUp === 'function') return await interaction.followUp(originalPayload);
            } catch (_) {}
          }
          logger && logger.warn && logger.warn('safeReply: editReply/followUp failed', { error: e2 && (e2.stack || e2) });
        }
      }
    }

    // If caller requested suppression of news reminder, skip. Otherwise prepend reminder to content if present on interaction.
    try {
      if (interaction && interaction._newsReminder && !payload.__suppressNewsReminder) {
        if (payload.components || payload.embeds) {
          // Skip reminder injection for structured payloads to avoid mixing incompatible content types.
        } else {
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
      if (usingStyledPayload) {
        try {
          return await interaction.reply(originalPayload);
        } catch (_) {}
      }
      logger && logger.warn && logger.warn('safeReply: reply failed, attempting defer+edit', { error: e && (e.stack || e) });
      try {
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: payload.ephemeral || false });
        return await interaction.editReply(payload);
      } catch (e2) {
        if (usingStyledPayload) {
          try {
            if (!interaction.deferred) await interaction.deferReply({ ephemeral: originalPayload && originalPayload.ephemeral ? true : false });
            return await interaction.editReply(originalPayload);
          } catch (_) {}
        }
        try {
          if (typeof interaction.followUp === 'function') return await interaction.followUp(payload);
        } catch (e3) {
          if (usingStyledPayload) {
            try {
              if (typeof interaction.followUp === 'function') return await interaction.followUp(originalPayload);
            } catch (_) {}
          }
          logger && logger.error && logger.error('safeReply: all reply strategies failed', { error: e3 && (e3.stack || e3) });
        }
      }
    }
  } catch (finalErr) {
    try { logger && logger.error && logger.error('safeReply: unexpected error', { error: finalErr && (finalErr.stack || finalErr) }); } catch (e) { try { fallbackLogger.warn('safeReply: failed logging unexpected error', e && (e.stack || e)); } catch (ignored) {} }
  }
}

module.exports = safeReply;
