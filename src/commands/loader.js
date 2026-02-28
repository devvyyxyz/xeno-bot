const fs = require('fs');
const path = require('path');

// Loads commands from src/commands supporting both flat files and directory-based commands.
// Directory layout expected: src/commands/<command>/index.js which exports the command object.
function loadCommands(commandsDir) {
  const commands = new Map();
  if (!fs.existsSync(commandsDir)) return commands;
  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
  for (const ent of entries) {
    try {
      if (ent.isFile() && ent.name.endsWith('.js')) {
        const filePath = path.join(commandsDir, ent.name);
        const command = require(filePath);
        if (command && command.name) commands.set(command.name, command);
      } else if (ent.isDirectory()) {
        const indexPath = path.join(commandsDir, ent.name, 'index.js');
        if (fs.existsSync(indexPath)) {
          const command = require(indexPath);
          if (command && command.name) commands.set(command.name, command);
        } else {
          // fallback: look for single JS file with same name as directory
          const fallback = path.join(commandsDir, ent.name, `${ent.name}.js`);
          if (fs.existsSync(fallback)) {
            const command = require(fallback);
            if (command && command.name) commands.set(command.name, command);
          }
        }
      }
    } catch (e) {
      // Do not throw; log via console.warn — index.js will wrap loader usage with logger
      console.warn('Failed loading command entry', ent.name, e && (e.stack || e));
    }
  }
  return commands;
}

module.exports = { loadCommands };
