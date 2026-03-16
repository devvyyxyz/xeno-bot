// Lightweight emoji resolver with fallback
const EMOJI_FALLBACK = '🔳';
function get(key, client) {
  try {
    const cfg = require('../../config/emojis.json');
    const val = cfg && cfg[key];
    if (!val) return EMOJI_FALLBACK;

    // If entry is an object, prefer explicit markup then fallback
    if (typeof val === 'object') {
      if (val.markup) {
        const m = String(val.markup).match(/^<a?:([a-zA-Z0-9_]+):([0-9]+)>$/);
        if (m && client && client.emojis && client.emojis.cache && client.emojis.cache.get && client.emojis.cache.get(m[2])) {
          return val.markup;
        }
        return val.fallback || EMOJI_FALLBACK;
      }
      if (val.fallback) return val.fallback;
      return EMOJI_FALLBACK;
    }

    // If string like <:name:id> check availability via client, otherwise return unicode or fallback
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

module.exports = { get };
const fs = require('fs');
const path = require('path');

const EMOJI_PATH = path.join(__dirname, '../../config/emojis.json');

function loadEmojis() {
  try {
    const raw = fs.readFileSync(EMOJI_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function get(name) {
  const emojis = loadEmojis();
  return emojis[name] || name;
}

function all() {
  return loadEmojis();
}

module.exports = { get, all, loadEmojis };
