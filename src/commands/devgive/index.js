const { getCommandsObject } = require('../../utils/commandsConfig');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: 'devgive',
  description: 'Developer-only: give credits to a user (owner only)',
  developerOnly: true,
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
