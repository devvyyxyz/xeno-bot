const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const eggTypes = require('../../../config/eggTypes.json');

const cmd = getCommandConfig('devgive') || {name: 'devgive', description: 'Developer-only: give credits or eggs to a user (owner only)', developerOnly: true};

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  developerOnly: true,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: buildSubcommandOptions('devgive', [
      {type: 1, name: 'credits', description: 'Give credits (placeholder)', options: [{name: 'user', description: 'User to receive credits', type: 6, required: true}, {name: 'amount', description: 'Credits amount (can be negative)', type: 10, required: true}]},
      {type: 1, name: 'egg', description: 'Give eggs (placeholder)', options: [{name: 'user', description: 'User to receive eggs', type: 6, required: true}, {name: 'egg_type', description: 'Egg type id', type: 3, required: true, autocomplete: true}, {name: 'amount', description: 'Egg amount', type: 4, required: false}]}
    ])
  },
  async autocomplete(interaction) {
    try {
      const ownerId = resolveOwnerId();
      if (!ownerId || String(interaction.user.id) !== String(ownerId)) return interaction.respond([]);
      const sub = (() => { try { return interaction.options.getSubcommand(); } catch (_) { return null; } })();
      const focused = interaction.options.getFocused ? interaction.options.getFocused(true) : null;
      if (sub !== 'egg' || !focused || focused.name !== 'egg_type') return interaction.respond([]);
      const q = String(focused.value || '').toLowerCase();
      const items = eggTypes
        .filter(e => !q || String(e.id).toLowerCase().includes(q) || String(e.name || '').toLowerCase().includes(q))
        .slice(0, 25)
        .map(e => ({ name: `${e.name} (${e.id})`, value: e.id }));
      return interaction.respond(items);
    } catch (e) {
      try { return interaction.respond([]); } catch (_) { return; }
    }
  },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const ownerId = resolveOwnerId();
    if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
      await safeReply(interaction, { content: 'This command is owner-only.', ephemeral: true }, { loggerName: 'command:devgive' });
      return;
    }
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (_) { return null; } })();
    await interaction.deferReply({ ephemeral: true });
    try {
      const userModel = require('../../models/user');
      if (sub === 'credits') {
        const target = interaction.options.getUser('user');
        const amount = Number(interaction.options.getNumber('amount'));
        if (!target || !Number.isFinite(amount)) {
          await safeReply(interaction, { content: 'Invalid user or amount.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        const newBal = await userModel.modifyCurrencyForGuild(String(target.id), null, 'credits', amount);
        await safeReply(interaction, { content: `Gave ${amount} credits to ${target}. New balance: ${newBal}.`, ephemeral: true }, { loggerName: 'command:devgive' });
        return;
      }
      if (sub === 'egg') {
        const target = interaction.options.getUser('user');
        const eggTypeId = interaction.options.getString('egg_type');
        const amount = Math.max(1, Number(interaction.options.getInteger('amount') || 1));
        const guildId = interaction.guildId;
        if (!guildId) {
          await safeReply(interaction, { content: 'This subcommand can only be used in a server.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        const eggType = eggTypes.find(e => String(e.id) === String(eggTypeId));
        if (!target || !eggType) {
          await safeReply(interaction, { content: 'Invalid user or egg type.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        await userModel.addEggsForGuild(String(target.id), String(guildId), amount, String(eggTypeId));
        await safeReply(interaction, { content: `Gave ${eggType.emoji || ''} ${eggType.name} x${amount} to ${target}.`, ephemeral: true }, { loggerName: 'command:devgive' });
        return;
      }
      await safeReply(interaction, { content: 'Unknown subcommand.', ephemeral: true }, { loggerName: 'command:devgive' });
    } catch (err) {
      await safeReply(interaction, { content: `Failed: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:devgive' });
    }
  },
  async executeMessage(message, args) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(message.author.id) !== String(ownerId)) {
      try { await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    const target = message.mentions.users && message.mentions.users.first();
    const maybeId = args && args.length ? args[0] : null;
    const amountArg = args && args.length > 1 ? args[1] : args && args.length === 1 ? args[0] : null;
    let targetId = null;
    if (target) targetId = String(target.id);
    else if (maybeId && /^\d+$/.test(maybeId)) targetId = maybeId;

    if (!targetId || !amountArg) {
      try { await message.reply({ content: 'Usage: !devgive @user <amount>', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    const amt = Number(amountArg);
    if (Number.isNaN(amt) || !Number.isFinite(amt)) {
      try { await message.reply({ content: 'Amount must be a number.', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    try {
      const userModel = require('../../models/user');
      const newBal = await userModel.modifyCurrencyForGuild(String(targetId), null, 'credits', amt);
      const mention = target ? `<@${targetId}>` : `<@${targetId}>`;
      await message.reply({ content: `Gave ${amt} credits to ${mention}. New balance: ${newBal}.`, allowedMentions: { repliedUser: false } });
    } catch (err) {
      try { await message.reply({ content: `Failed to give credits: ${err && (err.message || err)}`, allowedMentions: { repliedUser: false } }); } catch (e) {}
    }
  }
};
