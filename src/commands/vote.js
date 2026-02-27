const { ActionRowBuilder } = require('discord.js');
const { LinkButtonBuilder } = require('@discordjs/builders');
const { getCommandConfig } = require('../utils/commandsConfig');
const links = require('../../config/links.json');

const cmd = getCommandConfig('vote') || {
  name: 'vote',
  description: 'Vote for the bot on top.gg.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new LinkButtonBuilder()
        .setLabel('Vote on Top.gg')
        .setURL(links.vote)
    );
    await interaction.reply({ content: 'Support the bot by voting!', components: [row], ephemeral: false });
  }
};
