const { EmbedBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { getCommandConfig } = require('../../utils/commandsConfig');

function chunkJoin(list, sep = ', ', max = 900) {
  const out = [];
  if (!Array.isArray(list)) return out;
  let cur = '';
  for (const item of list) {
    const piece = (cur ? sep : '') + item;
    if ((cur + piece).length > max) {
      if (cur) out.push(cur);
      cur = item;
    } else {
      cur += piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function loadCredits() {
  try {
    const p = path.join(__dirname, '..', '..', '..', 'config', 'credits.json');
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

const cfg = getCommandConfig('credits') || { name: 'credits', description: 'Show bot credits and contributors.' };

module.exports = {
  name: cfg.name,
  description: cfg.description,
  data: { name: cfg.name, description: cfg.description },
  async executeInteraction(interaction) {
    await interaction.deferReply({ ephemeral: cfg.ephemeral === true });
    const credits = loadCredits() || {};
    const botAvatar = interaction.client && interaction.client.user ? interaction.client.user.displayAvatarURL({ size: 1024 }) : null;

    const embed = new EmbedBuilder()
      .setTitle('Credits')
      .setColor(require('../../utils/commandsConfig').getCommandsObject().colour || '#bab25d')
      .setDescription(`Made by ${credits.madeBy || 'Unknown'}`)
      .setThumbnail(botAvatar || undefined);

    if (credits.contributors && credits.contributors.length) {
      const chunks = chunkJoin(credits.contributors, ', ', 900);
      chunks.forEach((c, idx) => {
        embed.addFields({ name: idx === 0 ? 'Contributors' : 'Contributors (cont.)', value: c, inline: false });
      });
    }

    if (credits.originalImage) embed.addFields({ name: 'Original Cat Image', value: credits.originalImage, inline: false });
    if (credits.apis && credits.apis.length) embed.addFields({ name: 'APIs', value: credits.apis.join(', '), inline: false });
    if (credits.openSource && credits.openSource.length) embed.addFields({ name: 'Open Source Projects', value: credits.openSource.join(', '), inline: false });
    if (credits.artAndMore) embed.addFields({ name: 'Art, suggestions, and more', value: credits.artAndMore, inline: false });
    if (credits.bannerArt) embed.addFields({ name: 'Banner art', value: credits.bannerArt, inline: false });
    if (credits.testers && credits.testers.length) embed.addFields({ name: 'Testers', value: credits.testers.join(', '), inline: false });
    embed.addFields({ name: 'Enjoying the bot', value: credits.enjoying || 'You <3', inline: false });

    await interaction.editReply({ embeds: [embed] });
  }
};
