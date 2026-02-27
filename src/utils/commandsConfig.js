const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'commands.json');

function loadCommands() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
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
