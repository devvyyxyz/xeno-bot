const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const eggTypes = require('../../../config/eggTypes.json');
const userModel = require('../../models/user');
const fallbackLogger = require('../../utils/fallbackLogger');

const cmd = getCommandConfig('give') || {
  name: 'give',
  description: 'Give items to users (admin only)'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions || ['Administrator'],
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: buildSubcommandOptions('give', [
      {type: 1, name: 'egg', description: 'Give eggs (placeholder)', options: [{name: 'user', description: 'User to give the egg to', type: 6, required: true}, {name: 'egg_type', description: 'Type of egg to give', type: 3, required: true, autocomplete: true}, {name: 'amount', description: 'Number of eggs to give', type: 4, required: false}]}
    ])
  },
  async autocomplete(interaction) {
    const autocomplete = require('../../utils/autocomplete');
    const eggTypes = require('../../../config/eggTypes.json');
    return autocomplete(interaction, eggTypes, { map: e => ({ name: e.name, value: e.id }), max: 25 });
  },
  async executeInteraction(interaction) {
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const subCfg = sub ? (getCommandConfig(`give ${sub}`) || getCommandConfig(`give.${sub}`)) : null;
    if (subCfg && subCfg.developerOnly) {
      const cfg = require('../../../config/config.json');
      const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
      if (!ownerId || interaction.user.id !== ownerId) {
        const safeReply = require('../../utils/safeReply');
        await safeReply(interaction, { content: 'Only the bot developer/owner can run this subcommand.', ephemeral: true }, { loggerName: 'command:give' });
        return;
      }
    }
    if (sub === 'egg') {
      if (!interaction.memberPermissions || !interaction.memberPermissions.has('Administrator')) {
        const safeReply = require('../../utils/safeReply');
        await safeReply(interaction, { content: 'You must be an admin to use this command.', ephemeral: true }, { loggerName: 'command:give' });
        return;
      }
      await interaction.deferReply({ ephemeral: false });
      const target = interaction.options.getUser('user');
      const eggTypeId = interaction.options.getString('egg_type');
      const amount = interaction.options.getInteger('amount') || 1;
      const guildId = interaction.guildId;
      const eggType = eggTypes.find(e => e.id === eggTypeId);
      if (!eggType) {
        const safeReply = require('../../utils/safeReply');
        await safeReply(interaction, { content: 'Invalid egg type.', ephemeral: true }, { loggerName: 'command:give' });
        return;
      }
      const baseLogger = require('../../utils/logger');
      if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.addEggs.start', category: 'db', data: { target: target.id, guildId, eggTypeId, amount } }); } catch (e) { try { require('../../utils/logger').get('command:give').warn('Failed to add sentry breadcrumb (db.addEggs.start)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging give breadcrumb error (db.addEggs.start)', le && (le.stack || le)); } catch (ignored) {} } } }
      await userModel.addEggsForGuild(target.id, guildId, amount, eggTypeId);
      if (baseLogger && baseLogger.sentry) { try { baseLogger.sentry.addBreadcrumb({ message: 'db.addEggs.finish', category: 'db', data: { target: target.id, guildId } }); } catch (e) { try { require('../../utils/logger').get('command:give').warn('Failed to add sentry breadcrumb (db.addEggs.finish)', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging give breadcrumb error (db.addEggs.finish)', le && (le.stack || le)); } catch (ignored) {} } } }
      const safeReply = require('../../utils/safeReply');
      await safeReply(interaction, { content: `Gave ${eggType.emoji} ${eggType.name} x${amount} to ${target}.`, ephemeral: true }, { loggerName: 'command:give' });
    }
  }
};
