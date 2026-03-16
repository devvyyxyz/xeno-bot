const safeReply = require('../utils/safeReply');
const { MessageFlags } = require('discord.js');

const logger = require('../utils/logger').get('components');

async function updateInteraction(interaction, payload = {}) {
  // Ensure flags include ComponentsV2 unless caller explicitly set flags
  const p = Object.assign({}, payload);
  if (!Object.prototype.hasOwnProperty.call(p, 'flags')) p.flags = MessageFlags.IsComponentsV2;
  try {
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

    if (interaction && typeof interaction.update === 'function') {
      return await interaction.update(p);
    }
    // Fallback to safeReply which handles replies/edits/followups
    return await safeReply(interaction, p);
  } catch (err) {
    // Final fallback: try safeReply
    try { return await safeReply(interaction, p); } catch (_) { throw err; }
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
