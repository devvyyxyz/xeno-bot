const safeReply = require('../utils/safeReply');
const { MessageFlags } = require('discord.js');
const { extractErrorInfo } = require('../lib/safeUtils');

const logger = require('../utils/logger').get('components');

async function updateInteraction(interaction, payload = {}) {
  // Ensure flags include ComponentsV2 unless caller explicitly set flags
  const p = Object.assign({}, payload);
  if (!Object.prototype.hasOwnProperty.call(p, 'flags')) p.flags = MessageFlags.IsComponentsV2;
  try {
    const dumpInteractionState = (it) => {
      try {
        if (!it) return null;
        return {
          id: it.id || null,
          type: it.type || null,
          userId: (it.user && it.user.id) ? it.user.id : (it.userId || null),
          channelId: it.channel && it.channel.id ? it.channel.id : (it.channelId || null),
          replied: !!it.replied,
          deferred: !!it.deferred,
          hasUpdate: typeof it.update === 'function',
          hasEdit: typeof it.edit === 'function',
          messagePresent: !!(it.message && it.message.id),
          messageEditable: !!(it.message && typeof it.message.edit === 'function')
        };
      } catch (_) { return null; }
    };

    // If components are present, attempt to pre-validate each to surface
    // which component index is causing validation to fail. This logs details
    // to `components` logger so we can inspect problematic payloads.
    try {
      if (p && p.components && Array.isArray(p.components)) {
        for (let idx = 0; idx < p.components.length; idx += 1) {
          const comp = p.components[idx];
          try {
            if (comp && typeof comp.toJSON === 'function') comp.toJSON(false);
          } catch (innerErr) {
            try {
              logger.error('Component validation pre-check failed', { index: idx, error: innerErr && (innerErr.stack || innerErr.message || innerErr) });
            } catch (_) { /* ignore logging errors */ }
          }
        }
      }
    } catch (pvErr) {
      try { logger.warn('Pre-validation encountered error', { error: pvErr && (pvErr.stack || pvErr.message || pvErr) }); } catch (_) { /* ignore */ }
    }
    // Prefer interaction.update when available
    // Attempt to serialize components and log detailed info before updating.
    try {
      if (p && p.components && Array.isArray(p.components)) {
        const serialized = [];
        for (let idx = 0; idx < p.components.length; idx += 1) {
          const comp = p.components[idx];
          try {
            const json = (typeof comp.toJSON === 'function') ? comp.toJSON(false) : comp;
            serialized.push({ index: idx, ok: true, size: JSON.stringify(json).length });
          } catch (serErr) {
            try { logger.error('Component serialization error', { index: idx, error: serErr && (serErr.stack || serErr.message || serErr) }); } catch (_) { /* ignore */ }
            serialized.push({ index: idx, ok: false, error: String(serErr && (serErr.stack || serErr.message || serErr)) });
          }
        }
        try { logger.info('Pre-send component serialization', { components: serialized }); } catch (_) { /* ignore */ }
      }
    } catch (serAllErr) {
      try { logger.warn('Failed during pre-serialization pass', { error: serAllErr && (serAllErr.stack || serAllErr.message || serAllErr) }); } catch (_) { /* ignore */ }
    }

    // If caller passed a Message-like object, prefer editing it directly.
    if (interaction && typeof interaction.edit === 'function') {
      try {
        const editPayload = Object.assign({}, p);
        delete editPayload.flags;
        delete editPayload.ephemeral;
        return await interaction.edit(editPayload);
      } catch (msgErr) {
        try { logger && logger.warn && logger.warn('components: direct message.edit failed', { error: msgErr && (msgErr.stack || msgErr), interaction: dumpInteractionState(interaction) }); } catch (_) { /* ignore */ }
        // fallthrough to interaction.update or safeReply below
      }
    }

    if (interaction && typeof interaction.update === 'function') {
      try {
        return await interaction.update(p);
      } catch (updateErr) {
        try { logger && logger.warn && logger.warn('components: interaction.update failed, attempting message edit', { error: updateErr && (updateErr.stack || updateErr), payloadSummary: (p && p.components) ? `components:${p.components.length}` : (p && p.content) ? String(p.content).slice(0,200) : null, interaction: dumpInteractionState(interaction) }); } catch (_) { /* ignore */ }
        try {
          if (interaction && typeof interaction.message === 'object' && typeof interaction.message.edit === 'function') {
            const editPayload = Object.assign({}, p);
            delete editPayload.flags;
            delete editPayload.ephemeral;
            return await interaction.message.edit(editPayload);
          }
          // Also try interaction.edit if available (some objects may expose both)
          if (interaction && typeof interaction.edit === 'function') {
            const editPayload2 = Object.assign({}, p);
            delete editPayload2.flags;
            delete editPayload2.ephemeral;
            return await interaction.edit(editPayload2);
          }
        } catch (msgEditErr) {
          try { logger && logger.warn && logger.warn('components: message.edit after update failure also failed', { error: msgEditErr && (msgEditErr.stack || msgEditErr), payloadSummary: (p && p.components) ? `components:${p.components.length}` : (p && p.content) ? String(p.content).slice(0,200) : null, interaction: dumpInteractionState(interaction) }); } catch (_) { /* ignore */ }
        }
        // If editing the underlying message isn't possible, fall through to safeReply
      }
    }
    // Do not fall back to sending new messages. If we cannot update or edit
    // the original message, log and return null so callers know nothing changed.
    try { logger && logger.warn && logger.warn('components: unable to update or edit interaction; skipping send/followup', { interaction: dumpInteractionState(interaction), payloadSummary: (p && p.components) ? `components:${p.components.length}` : (p && p.content) ? String(p.content).slice(0,200) : null }); } catch (_) { /* ignore */ }
    return null;
  } catch (err) {
    // Final fallback: log and return null (do not send new messages)
    try { logger && logger.error && logger.error('components: unexpected error while updating interaction', { error: err && (err.stack || err) }); } catch (_) { /* ignore */ }
    return null;
  }
}

async function replyInteraction(interaction, payload = {}, opts = {}) {
  const p = Object.assign({}, payload);
  if (!Object.prototype.hasOwnProperty.call(p, 'flags')) p.flags = MessageFlags.IsComponentsV2;
  return safeReply(interaction, p, opts);
}

module.exports = {
  updateInteraction,
  replyInteraction
};
