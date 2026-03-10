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
    void _content;
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
  const dumpInteractionState = (it) => {
    try {
      if (!it) return null;
      return {
        id: it.id || null,
        commandName: it.commandName || null,
        userId: (it.user && it.user.id) ? it.user.id : null,
        replied: !!it.replied,
        deferred: !!it.deferred,
        ephemeral: it.ephemeral || null
      };
    } catch (_) { return null; }
  };
  const originalPayload = payload && typeof payload === 'object' ? { ...payload } : payload;
  const styledPayload = maybeBuildStyledNoticePayload(payload, opts);
  const usingStyledPayload = !!styledPayload;
  if (usingStyledPayload) payload = styledPayload;
  try {
    // Attach reminder before any reply/edit path so deferred interactions also receive it.
    try {
      if (interaction && interaction._newsReminder && payload && typeof payload === 'object' && !payload.__suppressNewsReminder) {
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

        const noticeLine = `📢 New article posted! Read it with ${mention}`;

        // For component payloads (especially V2), inject into first container when possible.
        if (Array.isArray(payload.components) && payload.components.length > 0) {
          let injected = false;
          try {
            const { TextDisplayBuilder } = require('discord.js');
            const first = payload.components[0];
            if (first && typeof first.addTextDisplayComponents === 'function') {
              first.addTextDisplayComponents(new TextDisplayBuilder().setContent(noticeLine));
              injected = true;
            }
          } catch (_) { /* fallback below */ }

          if (!injected) {
            // Fallback for non-builder payloads or embeds: prepend content line.
            if (payload.content) payload.content = `${noticeLine}\n\n${payload.content}`;
            else payload.content = noticeLine;
          }
        } else {
          if (payload.content) payload.content = `${noticeLine}\n\n${payload.content}`;
          else payload.content = noticeLine;
        }
      }
    } catch (e) { /* ignore reminder attach errors */ }

    // If interaction already replied or deferred, prefer editReply
    if (interaction.replied || interaction.deferred) {
        try {
          return await interaction.editReply(payload);
        } catch (e) {
          if (usingStyledPayload) {
            try {
              return await interaction.editReply(originalPayload);
            } catch (_) { /* ignore */ }
          }
          // fallthrough to followUp
            try {
              if (typeof interaction.followUp === 'function') {
                if (interaction.replied || interaction.deferred) {
                  return await interaction.followUp(payload);
                } else {
                  logger && logger.warn && logger.warn('safeReply: followUp skipped because interaction not replied/deferred', { interaction: dumpInteractionState(interaction) });
                }
              }
            } catch (e2) {
            if (usingStyledPayload) {
              try {
                if (typeof interaction.followUp === 'function') return await interaction.followUp(originalPayload);
              } catch (_) { /* ignore */ }
            }
            logger && logger.warn && logger.warn('safeReply: editReply/followUp failed', {
              error: e2 && (e2.stack || e2),
              payload: (typeof payload === 'object') ? payload : String(payload),
              originalPayload: (typeof originalPayload === 'object') ? originalPayload : String(originalPayload),
              interaction: dumpInteractionState(interaction)
            });
          }
        }
    }

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
        } catch (_) { /* ignore */ }
      }
      logger && logger.warn && logger.warn('safeReply: reply failed, attempting defer+edit', {
        error: e && (e.stack || e),
        payload: (typeof payload === 'object') ? payload : String(payload),
        interaction: dumpInteractionState(interaction)
      });
      try {
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: payload.ephemeral || false });
        return await interaction.editReply(payload);
      } catch (e2) {
        if (usingStyledPayload) {
          try {
            if (!interaction.deferred) await interaction.deferReply({ ephemeral: originalPayload && originalPayload.ephemeral ? true : false });
            return await interaction.editReply(originalPayload);
          } catch (_) { /* ignore */ }
        }
        try {
          if (typeof interaction.followUp === 'function') {
            if (interaction.replied || interaction.deferred) {
              return await interaction.followUp(payload);
            } else {
              logger && logger.warn && logger.warn('safeReply: followUp skipped because interaction not replied/deferred (final fallback)', { interaction: dumpInteractionState(interaction) });
            }
          }
        } catch (e3) {
          if (usingStyledPayload) {
            try {
              if (typeof interaction.followUp === 'function') return await interaction.followUp(originalPayload);
            } catch (_) { /* ignore */ }
          }
            logger && logger.error && logger.error('safeReply: all reply strategies failed', {
            error: e3 && (e3.stack || e3),
            payload: (typeof payload === 'object') ? payload : String(payload),
            originalPayload: (typeof originalPayload === 'object') ? originalPayload : String(originalPayload),
            interaction: dumpInteractionState(interaction)
          });
          // Final fallback: try sending a plain channel message if possible (handles expired/odd interactions)
          try {
            if (interaction && interaction.channel && typeof interaction.channel.send === 'function') {
              const text = (originalPayload && originalPayload.content) ? originalPayload.content : (typeof originalPayload === 'string' ? originalPayload : 'Unable to deliver reply.');
              await interaction.channel.send({ content: `*(Fallback message)* ${text}` });
            }
          } catch (chErr) {
            logger && logger.warn && logger.warn('safeReply: channel.send fallback failed', { error: chErr && (chErr.stack || chErr) });
          }
        }
      }
    }
  } catch (finalErr) {
    try { logger && logger.error && logger.error('safeReply: unexpected error', { error: finalErr && (finalErr.stack || finalErr) }); } catch (e) { try { fallbackLogger.warn('safeReply: failed logging unexpected error', e && (e.stack || e)); } catch (ignored) { /* ignore */ } }
  }
}

module.exports = safeReply;
