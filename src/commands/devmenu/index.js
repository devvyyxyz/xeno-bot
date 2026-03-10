function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: 'devmenu',
  description: 'Developer-only: show available dev text commands',
  developerOnly: true,
  data: { name: 'devmenu', description: 'Developer-only: show available dev text commands' },
  async executeInteraction(interaction) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
      try { await interaction.reply({ content: 'This command is owner-only.', ephemeral: true }); } catch (_) { /* ignore */ }
      return;
    }

    const content = '**Developer text commands**\n\n' +
      '• xen!devblacklist — Blacklist a server from the global leaderboard\n' +
      '• xen!devrestart — Restart the bot\n' +
      '• xen!devregister — Re-register slash commands\n\n' +
      'Run these commands as the bot owner (prefix xen!).';

    try {
      await interaction.reply({ content, ephemeral: true });
    } catch (e) {
      try { await interaction.reply({ content: 'Failed to show dev commands.', ephemeral: true }); } catch (_) { /* ignore */ }
    }
  }
};
