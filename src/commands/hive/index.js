const { ChatInputCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const hiveModel = require('../../models/hive');
const userModel = require('../../models/user');
const userResources = require('../../models/userResources');
const { getCommandConfig } = require('../../utils/commandsConfig');
const cmd = getCommandConfig('hive') || { name: 'hive', description: 'Manage your hive' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description)
    .addSubcommands(sub => sub.setName('create').setDescription('Create your personal hive'))
    .addSubcommands(sub => sub.setName('stats').setDescription('Show your hive stats')),

  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'create') {
      try {
        const existing = await hiveModel.getHiveByUser(userId);
        if (existing) return safeReply(interaction, { content: 'You already have a hive.', ephemeral: true });
        await hiveModel.createHiveForUser(userId, { name: `${interaction.user.username}'s Hive` });
        // ensure resources row
        await userResources.ensureRow(userId);
        await safeReply(interaction, { content: 'Hive created! You can view stats with `/hive stats`.', ephemeral: true });
        try { await interaction.user.send('Your hive has been created. Use /hive stats to view details.'); } catch (_) {}
      } catch (e) {
        await safeReply(interaction, { content: `Failed creating hive: ${e && (e.message || e)}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'stats') {
      try {
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive yet. Create one with `/hive create`.', ephemeral: true });
        const resources = await userResources.getResources(userId);
        const embed = new EmbedBuilder()
          .setTitle(`${interaction.user.username}'s Hive`)
          .addFields(
            { name: 'Hive Type', value: String(hive.hive_type || 'default'), inline: true },
            { name: 'Capacity', value: String(hive.capacity || 5), inline: true },
            { name: 'Royal Jelly', value: String(resources.royal_jelly || 0), inline: true }
          )
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        await safeReply(interaction, { content: `Failed fetching hive stats: ${e && (e.message || e)}`, ephemeral: true });
      }
      return;
    }
  }
};
