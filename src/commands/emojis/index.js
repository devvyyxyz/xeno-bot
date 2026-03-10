const { ChatInputCommandBuilder } = require('@discordjs/builders');
const {
  ActionRowBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder
} = require('@discordjs/builders');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const { getCommandConfig } = require('../../utils/commandsConfig');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const safeReply = require('../../utils/safeReply');
const emojisCfg = require('../../../config/emojis.json');

const cmd = getCommandConfig('emojis') || { name: 'emojis', description: 'View all emojis in the bot' };
const EMOJIS_PER_PAGE = 20;

function isDeveloper(interaction) {
  const cfg = require('../../../config/config.json');
  const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
  if (ownerId && interaction.user.id === ownerId) return true;
  
  const testerRoles = (cfg && Array.isArray(cfg.testerRoles)) ? cfg.testerRoles.map(r => String(r)) : [];
  if (testerRoles.length > 0 && interaction.member && interaction.member.roles) {
    if (typeof interaction.member.roles.has === 'function') {
      return testerRoles.some(roleId => interaction.member.roles.has(roleId));
    }
    if (interaction.member.roles.cache) {
      return testerRoles.some(roleId => interaction.member.roles.cache.has(roleId));
    }
  }
  
  return false;
}

function buildEmojiPage({ pageIdx = 0, expired = false, client = null }) {
  const emojiEntries = Object.entries(emojisCfg || {});
  const totalPages = Math.ceil(emojiEntries.length / EMOJIS_PER_PAGE);
  const safePageIdx = Math.max(0, Math.min(pageIdx, totalPages - 1));
  const start = safePageIdx * EMOJIS_PER_PAGE;
  const end = start + EMOJIS_PER_PAGE;
  const page = emojiEntries.slice(start, end);

  const container = new ContainerBuilder();

  addV2TitleWithBotThumbnail({ container, title: 'Emojis • Xeno-Bot Library', client });

  if (page.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('No emojis found.')
    );
  } else {
    const lines = page.map(([name, emoji]) => {
      return `\`${name}\` → ${emoji}`;
    }).join('\n');
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines)
    );
  }

  if (!expired) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const navRow = new ActionRowBuilder().addComponents(
      new SecondaryButtonBuilder()
        .setCustomId('emoji-prev-page')
        .setLabel('Prev')
        .setDisabled(safePageIdx === 0),
      new PrimaryButtonBuilder()
        .setCustomId('emoji-current-page')
        .setLabel(`${safePageIdx + 1} / ${Math.max(1, totalPages)}`)
        .setDisabled(true),
      new SecondaryButtonBuilder()
        .setCustomId('emoji-next-page')
        .setLabel('Next')
        .setDisabled(safePageIdx >= totalPages - 1)
    );
    container.addActionRowComponents(navRow);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('_Emoji view expired_')
    );
  }

  return [container];
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description),

  async executeInteraction(interaction) {
    const subCfg = getCommandConfig(`emojis`);
    if (subCfg && subCfg.developerOnly) {
      if (!isDeveloper(interaction)) {
        await safeReply(interaction, { content: 'Only bot developers/testers can run this command.', ephemeral: true }, { loggerName: 'command:emojis' });
        return;
      }
    }

    try {
      await interaction.deferReply({ ephemeral: true });
      const userId = String(interaction.user.id);

      await safeReply(
        interaction,
          { components: buildEmojiPage({ pageIdx: 0, client: interaction.client }), flags: MessageFlags.IsComponentsV2 },
        { loggerName: 'command:emojis' }
      );

      let msg = null;
      try { msg = await interaction.fetchReply(); } catch (_) { /* ignore */ }
      if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

      let currentPage = 0;
      const emojiEntries = Object.entries(emojisCfg || {});
      const totalPages = Math.ceil(emojiEntries.length / EMOJIS_PER_PAGE);

      const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === userId && (i.customId === 'emoji-prev-page' || i.customId === 'emoji-next-page'),
        time: 120_000
      });

      collector.on('collect', async i => {
        try {
          if (i.customId === 'emoji-prev-page') {
            currentPage = Math.max(0, currentPage - 1);
          } else if (i.customId === 'emoji-next-page') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
          }
          await i.update({ components: buildEmojiPage({ pageIdx: currentPage, client: interaction.client }) });
          } catch (err) {
          try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:emojis' }); } catch (_) { /* ignore */ }
        }
      });

      collector.on('end', async () => {
        try {
          if (msg) {
            await msg.edit({ components: buildEmojiPage({ pageIdx: currentPage, expired: true, client: interaction.client }) });
          }
        } catch (_) { /* ignore */ }
      });

      return;
    } catch (e) {
      const logger = require('../../utils/logger').get('command:emojis');
      logger.error('Unhandled error in emojis command', { error: e && (e.stack || e) });
      try { await safeReply(interaction, { content: `Error: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:emojis' }); } catch (_) { /* ignore */ }
    }
  },

  async autocomplete() {
    // No autocomplete needed for this command
    return;
  }
};
