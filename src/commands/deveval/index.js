const util = require('util');
const logger = require('../../utils/logger').get('command:deveval');
const fallbackLogger = require('../../utils/fallbackLogger');

// Simple blacklist for dangerous patterns. This is intentionally conservative.
const BLACKLIST = [
  /\brequire\s*\(/i,
  /\bchild_process\b/i,
  /\bprocess\.exit\b/i,
  /\bprocess\.env\b/i,
  /\bfs\./i,
  /\bspawn\b/i,
  /\bexec\b/i,
  /\bwhile\s*\(\s*true\s*\)/i,
  /for\s*\(\s*;;\s*\)/i
];

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
      for (const re of BLACKLIST) {
        if (re.test(code)) {
          try { await message.reply({ content: 'Refused to run unsafe code (blacklisted pattern detected).', allowedMentions: { repliedUser: false } }); } catch (e) {}
          logger.warn('deveval blocked unsafe code', { user: message.author.id });
          return;
        }
      }

      logger.info('Executing deveval', { user: message.author.id });
      let result = await eval(`(async () => { ${code} })()`);
      if (typeof result !== 'string') result = util.inspect(result, { depth: 1 });
      if (result.length > 1900) result = result.slice(0, 1900) + '...';
      await message.reply({ content: `\nResult:\n${result}`, allowedMentions: { repliedUser: false } });
      logger.info('deveval completed', { user: message.author.id });
    } catch (err) {
      try { await message.reply({ content: `Error: ${err && err.stack ? err.stack : String(err)}`.slice(0, 1900), allowedMentions: { repliedUser: false } }); } catch (e) { fallbackLogger.error('Failed replying to deveval error', e && (e.stack || e)); }
      logger.error('deveval failed', { user: message.author.id, error: err && (err.stack || err) });
    }
  }
};
