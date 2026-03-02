/**
 * create a MessageComponentCollector for an interaction by ensuring the
 * interaction has been replied/edited and fetching the Message to attach
 * the collector to. Returns { collector, message } or { collector: null, message: null }
 */
const logger = require('./logger').get('collectorHelper');

module.exports = async function createInteractionCollector(interaction, opts = {}) {
  const {
    embeds,
    components,
    time = 1000 * 60 * 10,
    ephemeral = false,
    filter = (i) => i.user.id === (interaction && interaction.user && interaction.user.id),
    edit = true,
    flags = undefined
  } = opts;
  // Optional collectorOptions will be merged into the options used when
  // creating the MessageComponentCollector (allows passing componentType, etc.)
  const collectorOptionsFromCaller = opts.collectorOptions || {};

  try {
    // Ensure reply exists
    if (!interaction.deferred && !interaction.replied) {
      try { await interaction.deferReply({ ephemeral }); } catch (e) { /* ignore */ }
    }

    // Send or edit the reply content
    const replyOpts = {};
    // Only include embeds if it's defined and not an empty array
    if (embeds !== undefined && !(Array.isArray(embeds) && embeds.length === 0)) {
      replyOpts.embeds = embeds;
    }
    // Only include components if it's defined and not an empty array
    if (components !== undefined && !(Array.isArray(components) && components.length === 0)) {
      replyOpts.components = components;
    }
    if (flags !== undefined) replyOpts.flags = flags;
    
    // Only send/edit if there's actual content
    const hasContent = Object.keys(replyOpts).length > 0;
    if (hasContent) {
      if (edit) {
        await interaction.editReply(replyOpts);
      } else {
        try { await interaction.reply({ ...replyOpts, fetchReply: true }); } catch (e) { /* ignore */ }
      }
    }

    // Fetch the message to attach collector
    let message = null;
    try { message = await interaction.fetchReply(); } catch (e) {
      logger.warn('Failed to fetch reply message for collector', { error: e && (e.stack || e) });
    }

    if (!message || typeof message.createMessageComponentCollector !== 'function') {
      logger.warn('Cannot attach message component collector (no message available)');
      return { collector: null, message: null };
    }

    const collectorOptions = Object.assign({ filter, time }, collectorOptionsFromCaller);
    const collector = message.createMessageComponentCollector(collectorOptions);
    return { collector, message };
  } catch (err) {
    logger.error('createInteractionCollector failed', { error: err && (err.stack || err) });
    return { collector: null, message: null };
  }
};
