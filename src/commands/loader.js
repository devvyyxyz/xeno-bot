const fs = require('fs');
const path = require('path');

// Loads commands from src/commands supporting both flat files and directory-based commands.
// Directory layout expected: src/commands/<command>/index.js which exports the command object.
function loadCommands(commandsDir) {
  const commands = new Map();
  if (!fs.existsSync(commandsDir)) return commands;
  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });

  // Collect directory names first so we can prefer directory-based commands
  const dirNames = new Set(entries.filter(e => e.isDirectory()).map(d => d.name));

  for (const ent of entries) {
    try {
      // Prefer directories (src/commands/<name>/index.js) when present
      if (ent.isDirectory()) {
        const indexPath = path.join(commandsDir, ent.name, 'index.js');
        if (fs.existsSync(indexPath)) {
          const command = require(indexPath);
          if (command && command.name) commands.set(command.name, command);
          continue;
        }

        // fallback: single js file inside directory named after directory
        const fallback = path.join(commandsDir, ent.name, `${ent.name}.js`);
        if (fs.existsSync(fallback)) {
          const command = require(fallback);
          if (command && command.name) commands.set(command.name, command);
          continue;
        }
      }

      // If a directory with the same basename exists, skip the flat file to avoid duplicates
      if (ent.isFile() && ent.name.endsWith('.js')) {
        const base = path.basename(ent.name, '.js');
        if (dirNames.has(base)) continue;
        const filePath = path.join(commandsDir, ent.name);
        const command = require(filePath);
        if (command && command.name) commands.set(command.name, command);
      }
    } catch (e) {
      // Do not throw; log via console.warn — index.js will wrap loader usage with logger
      console.warn('Failed loading command entry', ent.name, e && (e.stack || e));
    }
  }
  return commands;
}

module.exports = { loadCommands };
