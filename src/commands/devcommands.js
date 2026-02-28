const { getCommandsObject } = require('../utils/commandsConfig');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: 'devcommands',
  description: 'Developer-only: list administrative and developer commands (owner only)',
  developerOnly: true,
  // Message-mode handler only
  async executeMessage(message, args) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(message.author.id) !== String(ownerId)) {
      try { await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    const commandsObj = getCommandsObject() || {};
    const adminCategory = commandsObj['Administration'] || {};
    const adminList = Object.values(adminCategory).map(c => `- ${c.name}: ${c.description || ''}`);

    const devCmds = Array.from((message.client && message.client.commands) ? message.client.commands.values() : [])
      .filter(c => c && c.developerOnly)
      .map(c => `- ${c.name}: ${c.description || ''}`);

    const parts = [];
    if (adminList.length) {
      parts.push('Administration commands:');
      parts.push(...adminList);
    }
    if (devCmds.length) {
      parts.push('\nDeveloper-only commands (from modules):');
      parts.push(...devCmds);
    }
    if (parts.length === 0) parts.push('No administrative or developer-only commands found.');

    // Send as a single reply (no embeds to keep compatibility with message-mode)
    try {
      await message.reply({ content: parts.join('\n'), allowedMentions: { repliedUser: false } });
    } catch (e) {
      // best-effort fallback
      try { await message.channel.send(parts.join('\n')); } catch (ignored) {}
    }
  }
};
