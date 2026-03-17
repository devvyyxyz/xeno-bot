const https = require('https');
const { ContainerBuilder, TextDisplayBuilder } = require('@discordjs/builders');
const { MessageFlags, EmbedBuilder } = require('discord.js');
const utils = require('../utils');
const logger = utils.logger.get('guildJoinLib');
const links = require('../../config/links.json');
const webhooks = require('../../config/webhooks.json');
const { buildLinkButtons } = utils.buttonBuilder;

function postWebhookJson(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(webhookUrl);
      const body = Buffer.from(JSON.stringify(payload));
      const path = url.search ? `${url.pathname}${url.search}` : `${url.pathname}?wait=true`;

      const req = https.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length
        }
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          const status = Number(res.statusCode || 0);
          if (status >= 200 && status < 300) {
            resolve({ status, body: responseBody });
            return;
          }
          reject(new Error(`HTTP ${status}: ${responseBody || 'empty response'}`));
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function sendGuildJoinV2Webhook({ guild, client }) {
  const webhookUrl = (process.env.GUILD_JOIN_WEBHOOK_URL || '').trim()
    || ((webhooks && typeof webhooks.guildJoinV2Webhook === 'string') ? webhooks.guildJoinV2Webhook.trim() : '');
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(webhookUrl)) {
    logger.warn('Guild join webhook URL missing or invalid; skipping webhook notify');
    return { ok: false, sent: false, reason: 'invalid_webhook_url' };
  }

  try {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## 🛰️ Bot Added to New Server'),
      new TextDisplayBuilder().setContent([
        `**Server:** ${guild.name}`,
        `**Server ID:** \`${guild.id}\``,
        `**Members:** ${guild.memberCount || 0}`,
        `**Owner ID:** \`${guild.ownerId || 'unknown'}\``,
        `**Bot:** ${client && client.user ? client.user.tag : 'Unknown Bot'}`,
        `**Joined At:** <t:${Math.floor(Date.now() / 1000)}:f>`
      ].join('\n'))
    );

    const payload = {
      components: [container.toJSON()],
      flags: MessageFlags.IsComponentsV2
    };

    try {
      await postWebhookJson(webhookUrl, payload);
      logger.info('Guild join V2 webhook sent', { guildId: guild.id });
      return { ok: true, sent: true, mode: 'v2' };
    } catch (v2Err) {
      logger.warn('Guild join V2 webhook failed; trying fallback', {
        guildId: guild.id,
        error: v2Err && (v2Err.stack || v2Err)
      });
      try {
        const fallbackEmbed = new EmbedBuilder()
          .setTitle('Bot Added to New Server')
          .setDescription([
            `Server: **${guild.name}**`,
            `Server ID: \`${guild.id}\``,
            `Members: ${guild.memberCount || 0}`,
            `Owner ID: \`${guild.ownerId || 'unknown'}\``,
            `Bot: ${client && client.user ? client.user.tag : 'Unknown Bot'}`
          ].join('\n'))
          .setColor(0x5865F2)
          .setTimestamp();

        await postWebhookJson(webhookUrl, { embeds: [fallbackEmbed.toJSON()] });
        logger.info('Guild join webhook sent via fallback embed', { guildId: guild.id });
        return { ok: true, sent: true, mode: 'fallback_embed' };
      } catch (fallbackErr) {
        logger.warn('Guild join webhook fallback send failed', {
          guildId: guild.id,
          error: fallbackErr && (fallbackErr.stack || fallbackErr)
        });
        return { ok: false, sent: false, reason: 'send_failed' };
      }
    }
  } catch (err) {
    logger.warn('Guild join webhook send failed', { guildId: guild && guild.id, error: err && (err.stack || err) });
    return { ok: false, sent: false, reason: 'send_failed', error: err && (err.message || String(err)) };
  }
}

async function findHelpMention(clientRef, guildId) {
  try {
    if (!clientRef.application) await clientRef.application?.fetch();
    if (guildId) {
      try {
        const guildCmds = await clientRef.application.commands.fetch({ guildId });
        const found = guildCmds.find(c => c.name === 'help');
        if (found) return `</help:${found.id}>`;
      } catch (_) { /* ignore */ void 0; }
    }
    try {
      const globalCmds = await clientRef.application.commands.fetch();
      const found = globalCmds.find(c => c.name === 'help');
      if (found) return `</help:${found.id}>`;
    } catch (_) { /* ignore */ void 0; }
  } catch (e) {
    logger.warn('Failed resolving /help command id', { error: e && (e.stack || e) });
  }
  return '/help';
}

module.exports = {
  sendGuildJoinV2Webhook,
  findHelpMention,
};
