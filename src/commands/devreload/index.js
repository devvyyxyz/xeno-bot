const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'devreload',
  description: 'Developer-only: reload command modules (owner only)',
  developerOnly: true,
  async executeMessage(message) {
    const owner = (process.env.BOT_CONFIG_PATH ? (() => { try { const bc = require(process.env.BOT_CONFIG_PATH); return bc && bc.owner; } catch (e) { return null; } })() : null) || process.env.OWNER || process.env.BOT_OWNER;
    if (!owner || String(message.author.id) !== String(owner)) return;
    const commandsPath = path.join(__dirname);
    try {
      const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
      const newMap = new Map();
      for (const file of files) {
        const full = path.join(commandsPath, file);
        try {
          delete require.cache[require.resolve(full)];
        } catch (e) {}
        try {
          const cmd = require(full);
          if (cmd && cmd.name && message.client && message.client.commands) {
            message.client.commands.set(cmd.name, cmd);
            newMap.set(cmd.name, cmd);
          }
        } catch (e) {
          // ignore individual failures
        }
      }
      await message.reply({ content: `Reloaded ${newMap.size} command(s).`, allowedMentions: { repliedUser: false } });
    } catch (err) {
      try { await message.reply({ content: `Reload failed: ${err && err.message}`, allowedMentions: { repliedUser: false } }); } catch (e) {}
    }
  }
};
