const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'commands.json');

function loadCommands() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const obj = JSON.parse(raw);
    // normalize colour: allow hex string like "0xbab25d" -> numeric 0xbab25d
    try {
      if (obj && typeof obj.colour === 'string') {
        const s = obj.colour.trim();
        if (s.startsWith('#')) obj.colour = Number.parseInt(s.slice(1), 16);
        else if (/^0x[0-9a-f]+$/i.test(s)) obj.colour = Number.parseInt(s, 16);
      }
    } catch (e) {
      // ignore and return raw obj
    }
    return obj;
  } catch (e) {
    return {};
  }
}

function getCommandConfig(key) {
  const commands = loadCommands();
  if (!commands || typeof commands !== 'object') return undefined;
  for (const cat of Object.values(commands)) {
    if (cat && Object.prototype.hasOwnProperty.call(cat, key)) return cat[key];
  }
  return undefined;
}

function getCommandsObject() {
  return loadCommands();
}

module.exports = { getCommandConfig, getCommandsObject };
