const { getCommandConfig } = require('../../utils/commandsConfig');
const spawnManager = require('../../spawnManager');
const {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');
const fallbackLogger = require('../../utils/fallbackLogger');
const safeReply = require('../../utils/safeReply');
const { buildNoticeV2Payload } = require('../../utils/componentsV2');

const cmd = getCommandConfig('nextspawn') || { name: 'nextspawn', description: 'Show time until the next egg spawn for this server' };

function msToHuman(ms) {
  if (ms <= 0) return 'now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m`;
}

function buildNextSpawnPayload(info, customId, includeButton = true, expired = false) {
  const container = new ContainerBuilder();

  if (!info) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Next Spawn'),
      new TextDisplayBuilder().setContent('No spawn is currently scheduled for this server.')
    );
  } else if (info.active) {
    const human = msToHuman(info.activeSinceMs);
    const activeText = `An egg event is currently active (${info.numEggs} egg(s)), started ${human} ago.`;

    if (includeButton && !expired) {
      container.addSectionComponents(
        new SectionBuilder()
          .setSuccessButtonAccessory((button) => button.setCustomId(customId).setLabel('Refresh'))
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Spawn Active'),
            new TextDisplayBuilder().setContent(activeText)
          )
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## Spawn Active'),
        new TextDisplayBuilder().setContent(activeText)
      );
    }
  } else {
    const human = msToHuman(info.remainingMs);
    let desc = `Next spawn in ${human}.`;
    if (info.pendingReschedule) desc += '\nReschedule pending: will apply after active eggs clear.';

    if (includeButton && !expired) {
      container.addSectionComponents(
        new SectionBuilder()
          .setSuccessButtonAccessory((button) => button.setCustomId(customId).setLabel('Refresh'))
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Next Spawn'),
            new TextDisplayBuilder().setContent(desc)
          )
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## Next Spawn'),
        new TextDisplayBuilder().setContent(desc)
      );
    }
  }

  if (expired) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Refresh expired_'));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const logger = require('../../utils/logger').get('command:nextspawn');
    const customId = `nextspawn-refresh:${interaction.user.id}:${Date.now()}`;
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: cmd.ephemeral === true });
      }
    } catch (deferErr) {
    try { require('../../utils/logger').get('command:nextspawn').warn('Failed to defer reply', { error: deferErr && (deferErr.stack || deferErr) }); } catch (e) { try { require('../../utils/logger').get('command:nextspawn').warn('Failed logging defer reply failure in nextspawn', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging defer reply failure in nextspawn fallback', le && (le.stack || le)); } }
      const ageMs = Date.now() - (interaction.createdTimestamp || Date.now());
      if (ageMs > 10000) {
        // Interaction likely expired; bail quietly
        return;
      }
    }
    try {
      const info = spawnManager.getNextSpawnForGuild(interaction.guildId);
      await safeReply(interaction, buildNextSpawnPayload(info, customId, true, false), { loggerName: 'command:nextspawn' });

      let msg = null;
      try { msg = await interaction.fetchReply(); } catch (_) {}
      if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

      const collector = msg.createMessageComponentCollector({
        filter: i => i.customId === customId,
        time: 120_000
      });

      collector.on('collect', async i => {
        try {
          if (i.user.id !== interaction.user.id) {
            await safeReply(i, {
              ...buildNoticeV2Payload({ message: 'Only the command user can refresh this view.', tone: 'permission' }),
              ephemeral: true
            }, { loggerName: 'command:nextspawn' });
            return;
          }
          const fresh = spawnManager.getNextSpawnForGuild(interaction.guildId);
          await i.update(buildNextSpawnPayload(fresh, customId, true, false));
        } catch (err) {
          try {
            await safeReply(i, {
              ...buildNoticeV2Payload({ message: `Failed to refresh spawn info: ${err && (err.message || err)}`, tone: 'error' }),
              ephemeral: true
            }, { loggerName: 'command:nextspawn' });
          } catch (_) {}
        }
      });

      collector.on('end', async () => {
        try {
          const fresh = spawnManager.getNextSpawnForGuild(interaction.guildId);
          await safeReply(interaction, buildNextSpawnPayload(fresh, customId, false, true), { loggerName: 'command:nextspawn' });
        } catch (e) {
          logger.warn('Failed finalizing nextspawn refresh view', { error: e && (e.stack || e) });
        }
      });
    } catch (err) {
      try {
        await safeReply(interaction, {
          ...buildNoticeV2Payload({ message: `Failed to get next spawn info: ${err && (err.message || err)}`, tone: 'error' }),
          ephemeral: true
        }, { loggerName: 'command:nextspawn' });
      } catch (finalErr) {
        try { logger.error('Failed replying after nextspawn error (final)', { error: finalErr && (finalErr.stack || finalErr) }); } catch (e) { try { logger.warn('Failed logging final reply error in nextspawn', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging final reply error in nextspawn fallback', le && (le.stack || le)); } }
      }
    }
  }
};
