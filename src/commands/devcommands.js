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
    const adminEntries = Object.values(adminCategory).filter(c => !(c && (c.developerOnly === true || c.hidden === true)));

    const devCmds = Array.from((message.client && message.client.commands) ? message.client.commands.values() : [])
      .filter(c => c && c.developerOnly)
      .map(c => ({ name: c.name, description: c.description || '' }));

    const fields = [];
    if (adminEntries.length) {
      fields.push({ name: 'Administration commands', value: adminEntries.map(c => `**${c.name}** — ${c.description || ''}`).join('\n') });
    }
    if (devCmds.length) {
      fields.push({ name: 'Developer-only commands (from modules)', value: devCmds.map(c => `**${c.name}** — ${c.description || ''}`).join('\n') });
    }
    if (fields.length === 0) {
      try { await message.reply({ content: 'No administrative or developer-only commands found.', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    // Build embeds (chunk fields into pages)
    const { EmbedBuilder } = require('discord.js');
    const CHUNK = 2; // number of large fields per embed (keeps embed readable)
    const pages = [];
    for (let i = 0; i < fields.length; i += CHUNK) {
      const chunk = fields.slice(i, i + CHUNK);
      const embed = new EmbedBuilder()
        .setTitle('Developer / Admin Commands')
        .setColor(require('../utils/commandsConfig').getCommandsObject().colour || '#bab25d')
        .setTimestamp()
        .setFooter({ text: `Requested by ${message.author.username}` });
      for (const f of chunk) embed.addFields({ name: f.name, value: f.value || '\u200B' });
      pages.push(embed);
    }

    try {
      await message.reply({ embeds: [pages[0]], allowedMentions: { repliedUser: false } });
      for (let i = 1; i < pages.length; i++) await message.channel.send({ embeds: [pages[i]] });
    } catch (e) {
      try { await message.channel.send(fields.map(f => `${f.name}\n${f.value}`).join('\n\n')); } catch (ignored) {}
    }
  }
};
