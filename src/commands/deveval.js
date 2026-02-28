const util = require('util');
module.exports = {
  name: 'deveval',
  description: 'Developer-only: evaluate JS (owner only)',
  developerOnly: true,
  async executeMessage(message, args) {
    const owner = (process.env.BOT_CONFIG_PATH ? (() => { try { const bc = require(process.env.BOT_CONFIG_PATH); return bc && bc.owner; } catch (e) { return null; } })() : null) || process.env.OWNER || process.env.BOT_OWNER;
    if (!owner || String(message.author.id) !== String(owner)) return;
    const code = args.join(' ');
    if (!code) return message.reply({ content: 'No code provided.', allowedMentions: { repliedUser: false } });
    try {
      let result = await eval(`(async () => { ${code} })()`);
      if (typeof result !== 'string') result = util.inspect(result, { depth: 1 });
      if (result.length > 1900) result = result.slice(0, 1900) + '...';
      await message.reply({ content: `\nResult:\n${result}`, allowedMentions: { repliedUser: false } });
    } catch (err) {
      await message.reply({ content: `Error: ${err && err.stack ? err.stack : String(err)}`.slice(0, 1900), allowedMentions: { repliedUser: false } });
    }
  }
};
