// utils/buttonBuilder.js
// Helper to build link buttons (supports discord.js builders or raw component JSON)
function isValidHttpUrl(v) {
  if (!v || typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function buildLinkButtons(links, opts = {}) {
  // links can be an object of { key: url } or an array of { label, url }
  const logger = opts.logger || console;
  const buttons = [];

  let supportBuilders = false;
  let ButtonBuilder, ButtonStyle, ActionRowBuilder;
  try {
    ({ ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js'));
    supportBuilders = typeof ButtonBuilder === 'function' && typeof ActionRowBuilder === 'function';
  } catch (_) {
    supportBuilders = false;
  }

  const entries = Array.isArray(links)
    ? links.map((l, i) => [String(i), l])
    : Object.entries(links || {});

  for (const [, val] of entries) {
    let label = null;
    let url = null;
    if (typeof val === 'string') {
      url = val.trim();
    } else if (val && typeof val === 'object') {
      url = typeof val.url === 'string' ? val.url.trim() : (typeof val.link === 'string' ? val.link.trim() : null);
      label = typeof val.label === 'string' ? val.label.trim() : null;
    }

    if (!url || !isValidHttpUrl(url)) {
      logger && logger.warn && logger.warn('buildLinkButtons: skipping invalid URL', { url: url });
      continue;
    }

    // default labels when none provided
    if (!label) {
      try {
        const u = new URL(url);
        label = u.hostname.replace(/^www\./, '');
      } catch (_) {
        label = 'Link';
      }
    }

    if (supportBuilders) {
      try {
        const b = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
        buttons.push(b);
      } catch (e) {
        logger && logger.warn && logger.warn('buildLinkButtons: builder creation failed, falling back to raw', { error: e && (e.stack || e) });
        buttons.push({ type: 2, style: 5, label, url });
      }
    } else {
      buttons.push({ type: 2, style: 5, label, url });
    }
  }

  if (buttons.length === 0) return [];

  if (supportBuilders) {
    try {
      const row = new ActionRowBuilder().addComponents(...buttons);
      return [row];
    } catch (e) {
      logger && logger.warn && logger.warn('buildLinkButtons: failed building ActionRowBuilder, returning raw components', { error: e && (e.stack || e) });
      // fallthrough to raw
    }
  }

  // Raw component format
  return [{ type: 1, components: buttons }];
}

module.exports = { isValidHttpUrl, buildLinkButtons };
