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
  // direct flat lookup (category-level keys like 'shop', 'give', or 'evolve start')
  for (const cat of Object.values(commands)) {
    if (cat && Object.prototype.hasOwnProperty.call(cat, key)) return cat[key];
  }

  // support nested lookups with separators: '.', ' ' (space)
  const separators = ['.', ' '];
  let parts = null;
  for (const sep of separators) {
    if (key.includes(sep)) { parts = key.split(sep).map(p => p.trim()).filter(Boolean); break; }
  }
  if (!parts) return undefined;

  // find base command config in categories
  const base = parts[0];
  let baseConfig = undefined;
  for (const cat of Object.values(commands)) {
    if (cat && Object.prototype.hasOwnProperty.call(cat, base)) { baseConfig = cat[base]; break; }
  }
  if (!baseConfig || typeof baseConfig !== 'object') return undefined;

  // drill into nested path: allow either a `subcommands` map or direct nested keys
  let node = baseConfig;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (node && node.subcommands && Object.prototype.hasOwnProperty.call(node.subcommands, p)) {
      node = node.subcommands[p];
      continue;
    }
    if (node && Object.prototype.hasOwnProperty.call(node, p)) {
      node = node[p];
      continue;
    }
    // not found
    return undefined;
  }
  return node;
}

function getCommandsObject() {
  return loadCommands();
}

module.exports = { getCommandConfig, getCommandsObject };
