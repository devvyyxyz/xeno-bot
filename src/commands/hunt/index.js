const { EmbedBuilder } = require('discord.js');
const hostModel = require('../../models/host');
const { getCommandConfig } = require('../../utils/commandsConfig');

const cmd = getCommandConfig('hunt') || { name: 'hunt', description: 'Hunt for hosts to use in evolutions' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      { type: 1, name: 'go', description: 'Go hunt for a host (chance to find one)', options: [] },
      { type: 1, name: 'list', description: 'List your hunted hosts' }
    ]
  },

  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const userId = interaction.user.id;

    // Simple host pool — extend later or move to config
    const hostPool = [ 'Human', 'Dog', 'Engineer', 'Predator', 'Neomorph Candidate' ];

    if (sub === 'go') {
      try {
        // Randomly determine if user finds a host (75% chance)
        const found = Math.random() < 0.75;
        if (!found) return safeReply(interaction, { content: 'You searched but found no suitable hosts this time.', ephemeral: true });
        const hostType = hostPool[Math.floor(Math.random() * hostPool.length)];
        const host = await hostModel.addHostForUser(userId, hostType);
        const embed = new EmbedBuilder().setTitle('Hunt Success').setDescription(`You found a host: **${hostType}** (ID: ${host.id}).`).setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Hunt failed: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    if (sub === 'list') {
      try {
        const rows = await hostModel.listHostsByOwner(userId);
        if (!rows || rows.length === 0) return safeReply(interaction, { content: 'You have no hunted hosts. Use `/hunt go` to search.', ephemeral: true });
        const lines = rows.map(r => `• [${r.id}] ${r.host_type} — found ${new Date(r.created_at).toLocaleString()}`);
        const embed = new EmbedBuilder().setTitle(`${interaction.user.username}'s Hosts`).setDescription(lines.join('\n')).setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed listing hosts: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    return safeReply(interaction, { content: 'Unknown hunt subcommand.', ephemeral: true });
  }
};
