const { exec } = require('child_process');
const path = require('path');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: 'devregister',
  description: 'Developer-only: re-register slash commands (owner only)',
  developerOnly: true,
  async executeMessage(message) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(message.author.id) !== String(ownerId)) {
      try { await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } }); } catch (e) { /* ignore */ }
      return;
    }

    try {
      await message.reply({ content: '🔁 Starting slash command registration (deploy-commands.js)...', allowedMentions: { repliedUser: false } });
    } catch (e) { /* ignore */ }

    const script = path.join(process.cwd(), 'deploy-commands.js');
    const cmd = `node "${script}"`;
    const child = exec(cmd, { cwd: process.cwd(), env: process.env, timeout: 2 * 60 * 1000 }, (error, stdout, stderr) => {
      try {
        if (error) {
          const out = String(stderr || stdout || error.message).slice(0, 1900);
          message.channel.send({ content: `❌ Registration failed: ${error.message}\n\n${out}`, allowedMentions: { repliedUser: false } }).catch(() => {});
        } else {
          const out = String(stdout || '').slice(0, 1900);
          message.channel.send({ content: `✅ Registration finished. Output:\n\n${out}`, allowedMentions: { repliedUser: false } }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    });

    // Stream some output to the channel (best-effort) while the process runs
    if (child && child.stdout) {
      child.stdout.on('data', d => { try { message.channel.send({ content: `stdout: ${String(d).slice(0, 1800)}`, allowedMentions: { repliedUser: false } }).catch(() => {}); } catch (e) { /* ignore */ } });
    }
    if (child && child.stderr) {
      child.stderr.on('data', d => { try { message.channel.send({ content: `stderr: ${String(d).slice(0, 1800)}`, allowedMentions: { repliedUser: false } }).catch(() => {}); } catch (e) { /* ignore */ } });
    }
  }
};
