const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').get('command:previewjoin');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'previewjoin',
  description: 'Developer-only: preview the guild join embed in this channel',
  // message-mode only
  async executeMessage(message /* , args */) {
    try {
      // Allow only the configured bot owner (from profile file) or fallback to env DEV_OWNER
      let ownerId = process.env.DEV_OWNER;
      try {
        const cfgPath = process.env.BOT_CONFIG_PATH || path.join(__dirname, '..', '..', 'config', `bot.dev.json`);
        if (cfgPath && fs.existsSync(cfgPath)) {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
          if (cfg && cfg.owner) ownerId = String(cfg.owner);
        }
      } catch (e) {
        logger.warn('Failed reading bot profile for owner id', { error: e && (e.stack || e) });
      }

      if (!ownerId || message.author.id !== String(ownerId)) {
        try { await message.reply('You are not authorized to run this preview command.'); } catch (_) {}
        return;
      }

      const botName = message.client.user ? message.client.user.username : 'the bot';
      const avatarUrl = message.client.user ? message.client.user.displayAvatarURL() : undefined;

      // Try to resolve a proper /help mention (guild first, then global)
      const findHelpMention = async (clientRef, guildId) => {
        try {
          if (!clientRef.application) await clientRef.application?.fetch();
          if (guildId) {
            try {
              const guildCmds = await clientRef.application.commands.fetch({ guildId });
              const found = guildCmds.find(c => c.name === 'help');
              if (found) return `</help:${found.id}>`;
            } catch (_) {}
          }
          try {
            const globalCmds = await clientRef.application.commands.fetch();
            const found = globalCmds.find(c => c.name === 'help');
            if (found) return `</help:${found.id}>`;
          } catch (_) {}
        } catch (e) {
          logger.warn('Failed resolving /help command id', { error: e && (e.stack || e) });
        }
        return '/help';
      };

      const helpMention = await findHelpMention(message.client, message.guild ? message.guild.id : undefined);
      const embed = new EmbedBuilder()
        .setTitle(`Thanks for inviting ${botName}!`)
        .setDescription(`I'm ready to help. Use ${helpMention} to see available commands and setup instructions.`)
        .setColor(0x5865F2)
        .setThumbnail(avatarUrl)
        .setTimestamp()
        .setFooter({ text: 'Xeno Bot', iconURL: avatarUrl });

      await message.reply({ embeds: [embed] });
      logger.info('Preview join embed posted', { channelId: message.channel.id, author: message.author.id });
    } catch (err) {
      logger.error('Error in previewjoin command', { error: err && (err.stack || err) });
      try { await message.reply('Failed to post preview embed.'); } catch (_) {}
    }
  }
};
