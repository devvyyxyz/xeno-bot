const logger = require('../utils/logger').get('guildCreate');
const { PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const links = require('../../config/links.json');

module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild, client) {
    try {
      const botName = client.user ? client.user.username : 'the bot';

      // Resolve a proper mention for the /help command if available (guild first, then global)
      const findHelpMention = async (clientRef, guildId) => {
        try {
          if (!clientRef.application) await clientRef.application?.fetch();
          // Try guild commands first
          if (guildId) {
            try {
              const guildCmds = await clientRef.application.commands.fetch({ guildId });
              const found = guildCmds.find(c => c.name === 'help');
              if (found) return `</help:${found.id}>`;
            } catch (_) {}
          }
          // Fallback to global commands
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

      const avatarUrl = client.user ? client.user.displayAvatarURL() : undefined;
      const helpMention = await findHelpMention(client, guild.id);
      // Build a friendly embed to introduce the bot and point to help
      const embed = new EmbedBuilder()
        .setTitle(`Thanks for inviting ${botName}!`)
        .setDescription(`I'm ready to help. Use ${helpMention} to see available commands and setup instructions.`)
        .setColor(0x5865F2)
        .setThumbnail(avatarUrl)
        .setTimestamp()
        .setFooter({ text: 'Xeno Bot', iconURL: avatarUrl });

      // Build optional link buttons from config/links.json (defensive)
      const components = [];
      // Build buttons defensively: validate each URL using a simple scheme check and only add valid ones.
      try {
        let supportBuilders = false;
        try { const { ButtonBuilder } = require('discord.js'); supportBuilders = typeof ButtonBuilder === 'function'; } catch (_) { supportBuilders = false; }

        const buttons = [];
        if (links && typeof links.wiki === 'string') {
          const v = links.wiki.trim();
          if (/^https?:\/\//i.test(v)) {
            if (supportBuilders) {
              const { ButtonBuilder, ButtonStyle } = require('discord.js');
              buttons.push(new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(v));
            } else {
              buttons.push({ type: 2, style: 5, label: 'Documentation', url: v });
            }
          } else logger.warn('Invalid wiki URL in links.json, skipping Documentation button', { url: links.wiki });
        }

        if (links && typeof links.vote === 'string') {
          const v2 = links.vote.trim();
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
        const errStr = e ? (e.stack || String(e)) : 'no-error-object';
        let linksDump = null;
        try { linksDump = JSON.stringify(links); } catch (je) { linksDump = String(links); }
        logger.warn('Unexpected error while building link buttons for embed', { error: errStr, links: linksDump });
      }

      // helper to attempt sending to a channel and log failures
      const trySendToChannel = async (channel) => {
        try {
          await channel.send({ embeds: [embed] });
          logger.info('Sent join embed to channel', { guildId: guild.id, channelId: channel.id });
          return true;
        } catch (err) {
          logger.warn('Failed sending join embed to channel', { guildId: guild.id, channelId: channel.id, error: err && (err.stack || err) });
          return false;
        }
      };

      // 1) Prefer system channel if available and sendable
      try {
        const sys = guild.systemChannel;
        if (sys && sys.permissionsFor(client.user) && sys.permissionsFor(client.user).has(PermissionFlagsBits.SendMessages)) {
          const ok = await trySendToChannel(sys);
          if (ok) return;
        }
      } catch (e) {
        logger.warn('System channel check failed', { guildId: guild.id, error: e && (e.stack || e) });
      }

      // 2) Otherwise find the first channel the bot can send messages in (sorted by position)
      try {
        const sendable = guild.channels.cache
          .filter(c => c && typeof c.permissionsFor === 'function')
          .filter(c => c.permissionsFor(client.user) && c.permissionsFor(client.user).has(PermissionFlagsBits.SendMessages))
          .sort((a, b) => (a.position || 0) - (b.position || 0));

        if (sendable && sendable.size > 0) {
          const first = sendable.first();
          const ok = await trySendToChannel(first);
          if (ok) return;
        }
      } catch (e) {
        logger.warn('Failed scanning channels for sendable channel', { guildId: guild.id, error: e && (e.stack || e) });
      }

      // 3) If sending to a channel failed, DM the server owner
      try {
        const owner = await guild.fetchOwner();
        if (owner) {
          try {
            const ownerEmbed = new EmbedBuilder()
              .setTitle(`Thanks for inviting ${botName}!`)
              .setDescription(`I couldn't post in the server channels of **${guild.name}**, so I'm contacting you directly. Use /help to get started.`)
              .setColor(0x5865F2)
              .setTimestamp()
              .setFooter({ text: 'Xeno Bot', iconURL: avatarUrl });
            await owner.send({ embeds: [ownerEmbed] });
            logger.info('Sent DM to guild owner after join', { guildId: guild.id, ownerId: owner.id });
            return;
          } catch (dmErr) {
            logger.warn('Failed to DM guild owner after join', { guildId: guild.id, ownerId: owner.id, error: dmErr && (dmErr.stack || dmErr) });
          }
        }
      } catch (e) {
        logger.warn('Failed fetching guild owner to DM after join', { guildId: guild.id, error: e && (e.stack || e) });
      }

      logger.info('No available channel or owner DM to send join message', { guildId: guild.id });
    } catch (err) {
      logger.error('Unhandled error in guildCreate handler', { guildId: guild && guild.id, error: err && (err.stack || err) });
    }
  }
};
