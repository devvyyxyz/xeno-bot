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

  // If there are remaining parts, try to resolve the remainder as a single subcommand
  if (parts.length > 1 && node && node.subcommands && typeof node.subcommands === 'object') {
    const remainderParts = parts.slice(1);
    const remainder = remainderParts.join(' ');
    const altKeys = [remainder, remainderParts.join('_'), remainderParts.join('-'), remainderParts.join('')];
    for (const k of altKeys) {
      if (Object.prototype.hasOwnProperty.call(node.subcommands, k)) return node.subcommands[k];
    }

    const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
    const remNorm = normalize(remainder);
    for (const [k, v] of Object.entries(node.subcommands)) {
      if (Object.prototype.hasOwnProperty.call(node.subcommands, k)) {
        if (v && typeof v.name === 'string') {
          if (normalize(v.name).endsWith(remNorm) || normalize(k) === remNorm) return v;
        } else if (normalize(k) === remNorm) {
          return node.subcommands[k];
        }
      }
    }
  }

  // Fallback: attempt to drill piece-by-piece (for truly nested structures)
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
    return undefined;
  }
  return node;
}

function getCommandsObject() {
  return loadCommands();
}

/**
 * Build subcommand options array from commands.json for a command.
 * Uses descriptions from config, with optional fallback options to preserve existing option definitions.
 * Merges config descriptions with fallback options while preserving complex option structures.
 * @param {string} commandName - Command name (e.g., 'eggs', 'hive', 'evolve')
 * @param {Array} fallbackOptions - Optional fallback options with full structure; descriptions from config will override
 * @returns {Array} Array of subcommand option objects with descriptions from commands.json
 */
function buildSubcommandOptions(commandName, fallbackOptions = []) {
  const commands = loadCommands();
  if (!commands || typeof commands !== 'object') return fallbackOptions;

  // Find the command config
  let cmdConfig = null;
  for (const cat of Object.values(commands)) {
    if (cat && Object.prototype.hasOwnProperty.call(cat, commandName)) {
      cmdConfig = cat[commandName];
      break;
    }
  }

  if (!cmdConfig || !cmdConfig.subcommands || typeof cmdConfig.subcommands !== 'object') {
    return fallbackOptions;
  }

  // If no fallback options provided, build minimal options from config
  if (!fallbackOptions || !fallbackOptions.length) {
    const options = [];
    for (const [key, subCmd] of Object.entries(cmdConfig.subcommands)) {
      options.push({
        type: 1, // SUB_COMMAND
        name: key,
        description: subCmd.description || 'Subcommand',
        options: subCmd.options || []
      });
    }
    return options;
  }

  // Merge: use descriptions from config while preserving option structures from fallback
  const merged = [];
  for (const fallbackOpt of fallbackOptions) {
    const subKey = fallbackOpt.name;
    const configSubCmd = cmdConfig.subcommands[subKey];
    
    if (configSubCmd) {
      // Update description from config but keep all other properties from fallback
      merged.push({
        ...fallbackOpt,
        description: configSubCmd.description || fallbackOpt.description || 'Subcommand',
        // If config has options defined, use them; otherwise keep fallback options
        options: (configSubCmd.options && configSubCmd.options.length) ? configSubCmd.options : (fallbackOpt.options || [])
      });
    } else {
      // Keep fallback option if not found in config
      merged.push(fallbackOpt);
    }
  }

  return merged;
module.exports = { getCommandConfig, getCommandsObject, buildSubcommandOptions };
