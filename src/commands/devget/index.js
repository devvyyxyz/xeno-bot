module.exports = {
  name: 'devget',
  description: 'Developer-only: get runtime config or env value (owner only)',
  developerOnly: true,
  async executeMessage(message, args) {
    const owner = (process.env.BOT_CONFIG_PATH ? (() => { try { const bc = require(process.env.BOT_CONFIG_PATH); return bc && bc.owner; } catch (e) { return null; } })() : null) || process.env.OWNER || process.env.BOT_OWNER;
    if (!owner || String(message.author.id) !== String(owner)) return;
    const key = args[0];
    if (!key) return message.reply({ content: 'Usage: devget <key>', allowedMentions: { repliedUser: false } });
    // try client config first
    const client = message.client;
    let val = undefined;
    try {
      if (client && client.config) {
        const parts = key.split('.');
        let cur = client.config;
        for (const p of parts) { if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p]; else { cur = undefined; break; } }
        val = cur;
      }
    } catch (e) {}
    if (typeof val === 'undefined') val = process.env[key] || null;
    await message.reply({ content: `\n${key}: ${val === null || typeof val === 'undefined' ? 'null' : String(val)}`.slice(0, 1900), allowedMentions: { repliedUser: false } });
  }
};
