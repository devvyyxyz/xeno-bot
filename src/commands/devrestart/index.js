module.exports = {
  name: 'devrestart',
  description: 'Developer-only: restart the bot process (owner only)',
  developerOnly: true,
  async executeMessage(message) {
    const owner = (process.env.BOT_CONFIG_PATH ? (() => { try { const bc = require(process.env.BOT_CONFIG_PATH); return bc && bc.owner; } catch (e) { return null; } })() : null) || process.env.OWNER || process.env.BOT_OWNER;
    if (!owner || String(message.author.id) !== String(owner)) return;
    try {
      await message.reply({ content: 'Restarting bot...', allowedMentions: { repliedUser: false } });
    } catch (e) {}
    // Allow time for reply to be sent
    setTimeout(() => process.exit(0), 500);
  }
};
