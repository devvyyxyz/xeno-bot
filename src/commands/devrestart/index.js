function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: 'devrestart',
  description: 'Developer-only: restart the bot process (owner only)',
  developerOnly: true,
  async executeMessage(message, args) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(message.author.id) !== String(ownerId)) {
      try { await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
      return;
    }

    try {
      await message.reply({ content: '🔁 Restarting bot (graceful exit).', allowedMentions: { repliedUser: false } });
    } catch (e) { /* ignore */ }

    // Give the message a moment to send, then exit. Rely on external supervisor to restart.
    setTimeout(() => {
      try { process.exit(0); } catch (e) { /* ignore */ }
    }, 500);
  }
};
module.exports = {
  name: 'devrestart',
  description: 'Developer-only: restart the bot process — text mode removed; use /devmenu',
  developerOnly: true
};
