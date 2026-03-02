const { getCommandConfig } = require('../../utils/commandsConfig');
const evolutions = require('../../../config/evolutions.json');
const emojis = require('../../../config/emojis.json');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const {
  ActionRowBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('@discordjs/builders');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');

const cmd = getCommandConfig('pathway') || { name: 'pathway', description: 'View xenomorph evolution pathways' };

function buildPathwayListView({ client = null }) {
  const container = new ContainerBuilder();
  addV2TitleWithBotThumbnail({ container, title: 'Evolution Pathways', client });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('Select a pathway below to view its evolution stages and requirements.')
  );

  // Create select menu with pathway options
  const pathwayOptions = Object.entries(evolutions.pathways).map(([id, pathway]) => {
    return new StringSelectMenuOptionBuilder()
      .setLabel(id.charAt(0).toUpperCase() + id.slice(1))
      .setValue(id)
      .setDescription(pathway.description.slice(0, 100));
  });

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('pathway-select')
        .setPlaceholder('Choose a pathway to view')
        .addOptions(pathwayOptions)
    )
  );

  return [container];
}

function buildPathwayDetailView({ pathwayId, client = null }) {
  const pathway = evolutions.pathways[pathwayId];
  if (!pathway) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Pathway not found.'));
    return [container];
  }

  const container = new ContainerBuilder();
  const title = pathwayId.charAt(0).toUpperCase() + pathwayId.slice(1) + ' Pathway';
  addV2TitleWithBotThumbnail({ container, title, client });

  // Description
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**${pathway.description}**`)
  );

  // Evolution stages with emojis
  const stagesDisplay = pathway.stages.map((stage, index) => {
    const role = evolutions.roles[stage] || {};
    const emojiKey = role.emoji || stage;
    const emoji = emojis[emojiKey] || '';
    const display = role.display || stage;
    return `${index + 1}. ${emoji} **${display}**`;
  }).join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`### Evolution Stages\n${stagesDisplay}`)
  );

  // Requirements section
  const requirements = evolutions.requirements[pathwayId];
  if (requirements) {
    const reqLines = [];
    
    for (const [fromStage, req] of Object.entries(requirements)) {
      const fromRole = evolutions.roles[fromStage] || {};
      const toRole = evolutions.roles[req.to] || {};
      const fromEmoji = emojis[fromRole.emoji || fromStage] || '';
      const toEmoji = emojis[toRole.emoji || req.to] || '';
      
      let line = `${fromEmoji} → ${toEmoji} **${fromRole.display || fromStage}** to **${toRole.display || req.to}**`;
      
      const reqParts = [];
      if (req.cost_jelly !== undefined && req.cost_jelly > 0) {
        const jellyEmoji = emojis.Royal_jelly || '🍯';
        reqParts.push(`${jellyEmoji} ${req.cost_jelly} Royal Jelly`);
      }
      if (req.requires_host_types && req.requires_host_types.length > 0) {
        reqParts.push(`Host: ${req.requires_host_types.join(', ')}`);
      }
      
      if (reqParts.length > 0) {
        line += `\n  • ${reqParts.join(' • ')}`;
      }
      
      reqLines.push(line);
    }
    
    if (reqLines.length > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### Requirements\n${reqLines.join('\n\n')}`)
      );
    }
  }

  // Eggs using this pathway
  const eggIds = Object.entries(evolutions.eggPathways)
    .filter(([, pathway]) => pathway === pathwayId)
    .map(([eggId]) => eggId);
  
  if (eggIds.length > 0) {
    const eggTypes = require('../../../config/eggTypes.json');
    const eggNames = eggIds.map(id => {
      const eggMeta = eggTypes.find(e => e.id === id);
      const emoji = eggMeta?.emoji || '';
      const name = eggMeta?.name || id;
      return `${emoji} ${name}`;
    }).join(', ');
    
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### Eggs Using This Pathway\n${eggNames}`)
    );
  }

  // Back button
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new SecondaryButtonBuilder().setCustomId('pathway-back').setLabel('Back to Pathways')
    )
  );

  return [container];
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  requiredPermissions: cmd.requiredPermissions,
  options: cmd.options || [],
  developerOnly: !!cmd.developerOnly,
  category: cmd.category,
  enabled: cmd.enabled !== false,

  async executeInteraction(interaction) {
    const discordId = interaction.user.id;
    const guildId = interaction.guildId;
    const logger = require('../../utils/logger').get('command:pathway');
    const safeReply = require('../../utils/safeReply');

    try {
      await interaction.deferReply({ ephemeral: true });
      
      await safeReply(
        interaction,
        { components: buildPathwayListView({ client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true },
        { loggerName: 'command:pathway' }
      );

      let msg = null;
      try { msg = await interaction.fetchReply(); } catch (_) {}
      if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

      let currentPathway = null;

      const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === discordId,
        time: 300_000
      });

      collector.on('collect', async i => {
        try {
          if (i.customId === 'pathway-select') {
            currentPathway = i.values[0];
            await i.update({ components: buildPathwayDetailView({ pathwayId: currentPathway, client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
            return;
          }

          if (i.customId === 'pathway-back') {
            currentPathway = null;
            await i.update({ components: buildPathwayListView({ client: interaction.client }), flags: MessageFlags.IsComponentsV2 });
            return;
          }
        } catch (e) {
          logger.warn('Error handling pathway interaction', { error: e && (e.stack || e) });
        }
      });

      collector.on('end', () => {
        // No action needed
      });
    } catch (err) {
      logger.error('Unhandled error in pathway command', { error: err && (err.stack || err) });
      try {
        await safeReply(interaction, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:pathway' });
      } catch (replyErr) {
        logger.warn('Failed to send error reply in pathway command', { error: replyErr && (replyErr.stack || replyErr) });
      }
    }
  }
};
