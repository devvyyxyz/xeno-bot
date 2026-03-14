module.exports = {
  name: 'deveval',
  description: 'Evaluate JS code in bot context (disabled stub).',
  data: { name: 'deveval', description: 'Evaluate JS code in bot context (owner only)' },
  async executeInteraction(interaction) {
    try {
      await interaction.reply({ content: 'deveval is disabled in this build for safety.', ephemeral: true });
    } catch (e) {
      try { await interaction.followUp({ content: 'deveval is disabled.', ephemeral: true }); } catch (_) { /* ignore */ }
    }
  }
};
