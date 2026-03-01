const { getCommandConfig } = require('../../utils/commandsConfig');
const spawnManager = require('../../spawnManager');
const { EmbedBuilder } = require('discord.js');
const fallbackLogger = require('../../utils/fallbackLogger');
const safeReply = require('../../utils/safeReply');

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

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: false });
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
      if (!info) {
        await safeReply(interaction, { content: 'No spawn is currently scheduled for this server.' }, { loggerName: 'command:nextspawn' });
        return;
      }
      if (info.active) {
        const human = msToHuman(info.activeSinceMs);
        const embed = new EmbedBuilder().setTitle('Spawn Active').setDescription(`An egg event is currently active (${info.numEggs} egg(s)), started ${human} ago.`).setColor(0x00b2ff);
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      const human = msToHuman(info.remainingMs);
      const embed = new EmbedBuilder().setTitle('Next Spawn').setDescription(`Next spawn in ${human}.`).setColor(0x00b2ff);
      if (info.pendingReschedule) embed.setFooter({ text: 'Reschedule pending: will apply after active eggs clear.' });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const logger = require('../../utils/logger').get('command:nextspawn');
      try {
        await safeReply(interaction, { content: `Failed to get next spawn info: ${err && (err.message || err)}` }, { loggerName: 'command:nextspawn' });
      } catch (finalErr) {
        try { logger.error('Failed replying after nextspawn error (final)', { error: finalErr && (finalErr.stack || finalErr) }); } catch (e) { try { logger.warn('Failed logging final reply error in nextspawn', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging final reply error in nextspawn fallback', le && (le.stack || le)); } }
      }
    }
  }
};
