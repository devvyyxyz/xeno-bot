const fs = require('fs');
const path = require('path');

function setDeep(obj, pathParts, value) {
  let cur = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const p = pathParts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[pathParts[pathParts.length - 1]] = value;
}

module.exports = {
  name: 'devset',
  description: 'Developer-only: set value in config file and update runtime (owner only)',
  developerOnly: true,
  async executeMessage(message, args) {
    const owner = (process.env.BOT_CONFIG_PATH ? (() => { try { const bc = require(process.env.BOT_CONFIG_PATH); return bc && bc.owner; } catch (e) { return null; } })() : null) || process.env.OWNER || process.env.BOT_OWNER;
    if (!owner || String(message.author.id) !== String(owner)) return;
    const key = args[0];
    const raw = args.slice(1).join(' ');
    if (!key || !raw) return message.reply({ content: 'Usage: devset <key> <value>', allowedMentions: { repliedUser: false } });
    const cfgPath = path.join(__dirname, '..', '..', 'config', 'config.json');
    try {
      const file = fs.readFileSync(cfgPath, 'utf8');
      const cfg = JSON.parse(file);
      let val = raw;
      try { val = JSON.parse(raw); } catch (e) {}
      setDeep(cfg, key.split('.'), val);
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
      // update runtime client config if available
      if (message.client && message.client.config) {
        setDeep(message.client.config, key.split('.'), val);
      }
      await message.reply({ content: `Set ${key} = ${typeof val === 'string' ? val : JSON.stringify(val)}`, allowedMentions: { repliedUser: false } });
    } catch (err) {
      try { await message.reply({ content: `Failed to set: ${err && err.message}`, allowedMentions: { repliedUser: false } }); } catch (e) {}
    }
  }
};
