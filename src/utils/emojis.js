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
