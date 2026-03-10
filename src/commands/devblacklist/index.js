const lbModel = require('../../../src/models/leaderboardBlacklist') || require('../../models/leaderboardBlacklist');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: 'devblacklist',
  description: 'Developer-only: blacklist or unblacklist a guild from the global leaderboard (owner only)',
  developerOnly: true,
  async executeMessage(message, args) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(message.author.id) !== String(ownerId)) {
      try { await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
      return;
    }

    const sub = (args && args[0]) ? String(args[0]).toLowerCase() : null;
    let guildId = null;
    if (!sub || sub === 'current') {
      if (!message.guild) {
        try { await message.reply({ content: 'No guild context; provide a guild ID.', allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
        return;
      }
      guildId = String(message.guild.id);
    } else if (sub === 'remove' || sub === 'unblacklist' || sub === 'unban') {
      guildId = args && args[1] ? String(args[1]) : (message.guild ? String(message.guild.id) : null);
      if (!guildId) { try { await message.reply({ content: 'Provide guild ID to remove from blacklist.', allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ } return; }
      const ok = await lbModel.remove(guildId);
      try { await message.reply({ content: ok ? `✅ Guild ${guildId} removed from global leaderboard blacklist.` : `❌ Failed to remove guild ${guildId} from blacklist.`, allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
      return;
    } else if (/^\d+$/.test(sub)) {
      guildId = sub;
    } else {
      // allow a literal 'add' or 'blacklist' argument followed by id
      if ((sub === 'add' || sub === 'blacklist') && args[1] && /^\d+$/.test(args[1])) guildId = String(args[1]);
    }

    if (!guildId) {
      try { await message.reply({ content: 'Usage: xen!devblacklist <guildId|current> OR xen!devblacklist remove <guildId|current>', allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
      return;
    }

    try {
      const ok = await lbModel.add(guildId);
      try { await message.reply({ content: ok ? `✅ Guild ${guildId} added to global leaderboard blacklist.` : `❌ Failed to blacklist guild ${guildId}.`, allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
    } catch (err) {
      try { await message.reply({ content: `❌ Error blacklisting guild: ${err && err.message}`, allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
    }
  }
};
