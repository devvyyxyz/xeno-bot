const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').get('command:previewjoin');
const { EmbedBuilder } = require('discord.js');
const links = require('../../config/links.json');
const guildCreateHandler = require('../events/guildCreate');

module.exports = {
  name: 'previewjoin',
  description: 'Developer-only: preview the guild join embed in this channel',
  developerOnly: true,
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

      // Allow optional guild id argument: `previewjoin <guildId>` will cause the join embed
      // to be sent to that guild (if the bot is present). Useful for forcing the join message.
      const parts = (message.content || '').trim().split(/\s+/);
      const targetGuildId = parts[1] || null;
      if (targetGuildId) {
        try {
          const guild = await message.client.guilds.fetch(targetGuildId);
          if (!guild) {
            await message.reply(`Guild ${targetGuildId} not found or bot is not in that guild.`);
            return;
          }
          // Reuse the existing guildCreate handler to send the embed into that guild
          await guildCreateHandler.execute(guild, message.client);
          await message.reply(`Preview join embed sent to guild ${targetGuildId}.`);
        } catch (e) {
          logger.warn('Failed sending preview join to target guild', { targetGuildId, error: e && (e.stack || e) });
          try { await message.reply(`Failed to send preview to guild ${targetGuildId}: ${e && e.message ? e.message : 'error'}`); } catch (_) {}
        }
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

      // Build buttons with compatibility fallback
      const components = [];
      try {
        // Detect whether the runtime exposes builders from discord.js
        let supportBuilders = false;
        try { const { ButtonBuilder } = require('discord.js'); supportBuilders = typeof ButtonBuilder === 'function'; } catch (_) { supportBuilders = false; }

        const pageLinks = links.general || links;
        const buttons = [];
        if (pageLinks && typeof pageLinks.wiki === 'string') {
          const v = pageLinks.wiki.trim();
          if (/^https?:\/\//i.test(v)) {
            if (supportBuilders) {
              const { ButtonBuilder, ButtonStyle } = require('discord.js');
              buttons.push(new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(v));
            } else {
              buttons.push({ type: 2, style: 5, label: 'Documentation', url: v });
            }
          } else logger.warn('Invalid wiki URL in links.json, skipping Documentation button', { url: links.wiki });
        }

        if (pageLinks && typeof pageLinks.vote === 'string') {
          const v2 = pageLinks.vote.trim();
          if (/^https?:\/\//i.test(v2)) {
            if (supportBuilders) {
              const { ButtonBuilder, ButtonStyle } = require('discord.js');
              buttons.push(new ButtonBuilder().setLabel('Vote').setStyle(ButtonStyle.Link).setURL(v2));
            } else {
              buttons.push({ type: 2, style: 5, label: 'Vote', url: v2 });
            }
          } else logger.warn('Invalid vote URL in links.json, skipping Vote button', { url: links.vote });
        }

        if (buttons.length > 0) {
          if (supportBuilders) {
            const { ActionRowBuilder } = require('discord.js');
            components.push(new ActionRowBuilder().addComponents(...buttons));
          } else {
            components.push({ type: 1, components: buttons });
          }
        }
      } catch (e) {
        logger.warn('Unexpected error while building link buttons for preview embed', { error: e && (e.stack || e), links });
      }

      await message.reply({ embeds: [embed], components });
      logger.info('Preview join embed posted', { channelId: message.channel.id, author: message.author.id });
    } catch (err) {
      logger.error('Error in previewjoin command', { error: err && (err.stack || err) });
      try { await message.reply('Failed to post preview embed.'); } catch (_) {}
    }
  }
};
