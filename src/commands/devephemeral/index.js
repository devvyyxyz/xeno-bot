const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try {
        const bc = require(process.env.BOT_CONFIG_PATH);
        if (bc && bc.owner) return String(bc.owner);
      } catch (_) {}
    }
  } catch (_) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

function resolveTesterRoles() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try {
        const bc = require(process.env.BOT_CONFIG_PATH);
        if (bc && Array.isArray(bc.testerRoles)) return bc.testerRoles.map(r => String(r));
      } catch (_) {}
    }
  } catch (_) {}
  return [];
}

function isDeveloper(user, member) {
  const ownerId = resolveOwnerId();
  if (ownerId && String(user.id) === String(ownerId)) return true;

  const testerRoles = resolveTesterRoles();
  if (testerRoles.length > 0 && member && member.roles) {
    if (typeof member.roles.has === 'function') {
      return testerRoles.some(roleId => member.roles.has(roleId));
    }
    if (member.roles.cache) {
      return testerRoles.some(roleId => member.roles.cache.has(roleId));
    }
  }

  return false;
}

module.exports = {
  name: 'devephemeral',
  description: 'Developer-only: send a plain Components v2 ephemeral test message (text command)',
  developerOnly: true,
  
  async executeMessage(message) {
    if (!isDeveloper(message.author, message.member)) {
      try {
        await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } });
      } catch (_) {}
      return;
    }

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('✅ Components v2 ephemeral test (text command)')
      );

    try {
      await message.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { repliedUser: false }
      });
    } catch (err) {
      try {
        await message.reply({ content: `Failed: ${err && err.message}`, allowedMentions: { repliedUser: false } });
      } catch (_) {}
    }
  }
};
