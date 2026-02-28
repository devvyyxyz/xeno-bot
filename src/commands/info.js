const os = require('os');
const process = require('process');
const { getCommandConfig } = require('../utils/commandsConfig');
const db = require('../db');
const fallbackLogger = require('../utils/fallbackLogger');
const { version: nodeVersion } = process;
const { execSync } = require('child_process');
const pkg = require('../../package.json');

const cmd = getCommandConfig('info') || {
  name: 'info',
  description: 'Show system, tech, and global stats.'
};

const logger = require('../utils/logger').get('command:info');

// Track soft uptime and loop count
global._softUptimeStart = global._softUptimeStart || Date.now();
global._loopCount = global._loopCount || 0;

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    // System
    const osVersion = `${os.type()} ${os.release()}-${os.arch()}`;
    let pythonVersion = 'N/A';
    try {
      pythonVersion = execSync('python3 --version').toString().trim().replace('Python ', '');
    } catch (e) { try { logger.warn('Failed detecting python version for info command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging python detection error for info command', le && (le.stack || le)); } }
    const discordjsVersion = pkg.dependencies['discord.js'] || 'unknown';
    const cpuUsage = (os.loadavg()[0] / os.cpus().length * 100).toFixed(1) + '%';
    const ramUsage = ((process.memoryUsage().rss / os.totalmem()) * 100).toFixed(1) + '%';

    // Tech
    const hardUptimeMs = os.uptime() * 1000;
    const softUptimeMs = Date.now() - global._softUptimeStart;
    function fmt(ms) {
      const s = Math.floor(ms / 1000) % 60;
      const m = Math.floor(ms / 60000) % 60;
      const h = Math.floor(ms / 3600000) % 24;
      const d = Math.floor(ms / 86400000);
      return `${d}d ${h}h ${m}m ${s}s`;
    }
    let lastUpdate = 'unknown';
    try {
      const git = execSync('git log -1 --format=%ct').toString().trim();
      const last = Number(git) * 1000;
      lastUpdate = fmt(Date.now() - last);
    } catch (e) { try { logger.warn('Failed getting last git update for info command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging git update error for info command', le && (le.stack || le)); } }
    const loops = ++global._loopCount;
    // Sharding (simulate)
    const shards = 192;
    const guildShard = 1;

    // Global Stats
    let guilds = 'unknown', dbProfiles = 'unknown', dbUsers = 'unknown', dbChannels = 'unknown';
    try {
      const g = await db.knex('guild_settings').count('* as c').first();
      guilds = g && (g.c ?? g['count(*)']) ? g.c || g['count(*)'] : '0';
    } catch (e) { try { logger.warn('Failed querying guild count for info command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging guild count query error for info command', le && (le.stack || le)); } }
    try {
      const p = await db.knex('profiles').count('* as c').first();
      dbProfiles = p && (p.c ?? p['count(*)']) ? p.c || p['count(*)'] : '0';
    } catch (e) { try { logger.warn('Failed querying profiles count for info command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging profiles count query error for info command', le && (le.stack || le)); } }
    try {
      const u = await db.knex('users').count('* as c').first();
      dbUsers = u && (u.c ?? u['count(*)']) ? u.c || u['count(*)'] : '0';
    } catch (e) { try { logger.warn('Failed querying users count for info command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging users count query error for info command', le && (le.stack || le)); } }
    try {
      const c = await db.knex('channels').count('* as c').first();
      dbChannels = c && (c.c ?? c['count(*)']) ? c.c || c['count(*)'] : '0';
    } catch (e) { try { logger.warn('Failed querying channels count for info command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging channels count query error for info command', le && (le.stack || le)); } }

    const embed = {
      title: '📊 Bot Info',
      color: cmd.embedColor || 0x00b2ff,
      description: '**System**\n'
        + '```\n'
        + `OS Version:   ${osVersion}\n`
        + `Python:       ${pythonVersion}\n`
        + `discord.js:   ${discordjsVersion}\n`
        + `CPU usage:    ${cpuUsage}\n`
        + `RAM usage:    ${ramUsage}`
        + '\n```\n'
        + '\n**Tech**\n'
        + '```\n'
        + `Hard uptime:  ${fmt(hardUptimeMs)}\n`
        + `Soft uptime:  ${fmt(softUptimeMs)}\n`
        + `Last update:  ${lastUpdate}\n`
        + `Loops:        ${loops}\n`
        + `Shards:       ${shards}\n`
        + `Guild shard:  ${guildShard}`
        + '\n```\n'
        + '\n**Global Stats**\n'
        + '```\n'
        + `Guilds:       ${guilds}\n`
        + `DB Profiles:  ${dbProfiles}\n`
        + `DB Users:     ${dbUsers}\n`
        + `DB Channels:  ${dbChannels}`
        + '\n```',
    };
    const safeReply = require('../utils/safeReply');
    await safeReply(interaction, { embeds: [embed], ephemeral: cmd.ephemeral === true }, { loggerName: 'command:info' });
  }
};
