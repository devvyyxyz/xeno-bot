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
    edit = true
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
    if (edit) {
      await interaction.editReply({ embeds, components });
    } else {
      try { await interaction.reply({ embeds, components, fetchReply: true }); } catch (e) { /* ignore */ }
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
