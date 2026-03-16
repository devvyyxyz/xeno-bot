// Lightweight emoji resolver with fallback and availability checks
const fs = require('fs');
const path = require('path');

const EMOJI_PATH = path.join(__dirname, '../../config/emojis.json');
const EMOJI_FALLBACK = '🔳';

function loadEmojis() {
  try {
    const raw = fs.readFileSync(EMOJI_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

// Return the raw config object for consumers
function all() {
  return loadEmojis();
}

// Get an emoji value by key. If `client` is provided and the value is a custom emoji
// markup (<:name:id>), ensure the client has that emoji cached before returning it.
function get(key, client) {
  try {
    const emojis = loadEmojis();
    const val = emojis && emojis[key];
    if (!val) return EMOJI_FALLBACK;

    if (typeof val === 'object') {
      if (val.markup) {
        const m = String(val.markup).match(/^<a?:([a-zA-Z0-9_]+):([0-9]+)>$/);
        if (m) {
          const id = m[2];
          if (client && client.emojis && client.emojis.cache && client.emojis.cache.get && client.emojis.cache.get(id)) {
            return val.markup;
          }
          return val.fallback || EMOJI_FALLBACK;
        }
        return val.fallback || EMOJI_FALLBACK;
      }
      return val.fallback || EMOJI_FALLBACK;
    }

    if (typeof val === 'string') {
      const m = String(val).match(/^<a?:([a-zA-Z0-9_]+):([0-9]+)>$/);
      if (m) {
        const id = m[2];
        if (client && client.emojis && client.emojis.cache && client.emojis.cache.get && client.emojis.cache.get(id)) {
          return val;
        }
        return EMOJI_FALLBACK;
      }
      // Plain unicode or other string
      return val;
    }

    return EMOJI_FALLBACK;
  } catch (e) {
    return EMOJI_FALLBACK;
  }
}

module.exports = { get, all, loadEmojis };
