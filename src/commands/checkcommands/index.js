const logger = require('../../utils/logger').get('command:checkcommands');

module.exports = {
  name: 'checkcommands',
  description: 'Check whether slash commands are registered in this guild',
  developerOnly: true,
  // no `data` field: this is a message-mode utility command only
  async executeMessage(message /* , args */) {
    try {
      if (!message.guild) return message.reply('This command must be run in a server.');
      const app = message.client.application;
      if (!app) return message.reply('Client application not ready; try again shortly.');

      // Fetch guild-specific commands and global commands (best-effort)
      let guildList = null;
      let globalList = null;
      try {
        guildList = await app.commands.fetch({ guildId: message.guild.id });
      } catch (e) {
        logger.warn('Failed fetching guild commands', { guildId: message.guild.id, error: e && (e.stack || e) });
      }
      try {
        globalList = await app.commands.fetch();
      } catch (e) {
        logger.warn('Failed fetching global commands', { error: e && (e.stack || e) });
      }

      const parts = [];
      parts.push(`Guild (${message.guild.id}) commands: ${guildList ? guildList.size : 'unknown'}`);
      if (guildList && guildList.size > 0) parts.push(guildList.map(c => c.name).sort().join(', '));
      parts.push(`Global commands: ${globalList ? globalList.size : 'unknown'}`);
      if (globalList && globalList.size > 0) parts.push(globalList.map(c => c.name).sort().join(', '));

      // If lists are large, trim output
      const out = parts.join('\n') || 'No command information available.';
      // Use reply so it's visible where the user ran the command
      await message.reply(out);
    } catch (err) {
      logger.error('Error in checkcommands', { error: err && (err.stack || err) });
      try { await message.reply('Failed checking commands.'); } catch (_) {}
    }
  }
};
