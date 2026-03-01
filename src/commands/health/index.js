const { getCommandConfig } = require('../../utils/commandsConfig');
const fallbackLogger = require('../../utils/fallbackLogger');
const cmd = getCommandConfig('health') || { name: 'health', description: 'Show bot health (DB and telemetry)' };
const logger = require('../../utils/logger').get('command:health');
const db = require('../../db');
const baseLogger = require('../../utils/logger');
const path = require('path');
const fs = require('fs');

const lastHealthRun = new Map();
const AUDIT_LOG = path.join(__dirname, '..', '..', 'logs', 'audit.log');

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      {
        name: 'show',
        description: 'Show health information',
        type: 1,
        options: [
          {
            name: 'detail',
            description: 'Level of detail: summary, full, db, env, metrics',
            type: 3,
            required: false,
            choices: [
              { name: 'summary', value: 'summary' },
              { name: 'full', value: 'full' },
              { name: 'db', value: 'db' },
              { name: 'env', value: 'env' },
              { name: 'metrics', value: 'metrics' }
            ]
          }
        ]
      },
      {
        name: 'lastlogs',
        description: 'Tail recent application logs (owner only)',
        type: 1,
        options: [ { name: 'lines', description: 'Number of lines to show', type: 4, required: false } ]
      }
    ]
  },
  async executeInteraction(interaction) {
    const { EmbedBuilder } = require('discord.js');
    const cfg = require('../../../config/config.json');
    const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
    if (ownerId && interaction.user.id !== ownerId) {
      const safeReply = require('../../utils/safeReply');
      await safeReply(interaction, { content: 'Only the bot developer/owner can run this command.', ephemeral: true }, { loggerName: 'command:health' });
      return;
    }
    const now = new Date();
    let detail = 'summary';
    let sub = null;
    try {
      sub = interaction.options && interaction.options.getSubcommand ? (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })() : null;
    } catch (e) { sub = null; }
    if (sub === 'lastlogs') {
      detail = 'lastlogs';
    } else if (sub === 'show') {
      const optDetail = interaction.options && interaction.options.getString ? interaction.options.getString('detail') : null;
      detail = optDetail || 'summary';
    } else {
      const optDetail = interaction.options && interaction.options.getString ? interaction.options.getString('detail') : null;
      if (optDetail) detail = optDetail;
    }
    let dbStatus = '❌ FAILED';
    let dbInfo = '';
    let usersCount = 'n/a';
    let guildsCount = 'n/a';
    let dbError = null;
    try {
      await db.knex.raw('select 1 as result');
      const clientName = db.knex.client.config.client || 'unknown';
      dbStatus = '✅ OK';
      dbInfo = `Client: ${clientName}`;
      if (clientName === 'sqlite3') {
        const filename = db.knex.client.config.connection && db.knex.client.config.connection.filename;
        if (filename) dbInfo += ` | File: ${filename}`;
      } else if (process.env.DATABASE_URL) {
        try {
          const { URL } = require('url');
          const parsed = new URL(process.env.DATABASE_URL);
          dbInfo += ` | Host: ${parsed.hostname}` + (parsed.pathname ? ` | DB: ${parsed.pathname.replace('/', '')}` : '');
        } catch (e) { try { logger && logger.warn && logger.warn('Failed parsing DATABASE_URL in health command', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed parsing DATABASE_URL in health command', le && (le.stack || le)); } catch (ignored) {} } }
      }
      try { const u = await db.knex('users').count('* as c').first(); usersCount = u && (u.c ?? u['count(*)']) ? String(u.c || u['count(*)']) : '0'; } catch (e) { usersCount = 'err'; }
      try { const g = await db.knex('guild_settings').count('* as c').first(); guildsCount = g && (g.c ?? g['count(*)']) ? String(g.c || g['count(*)']) : '0'; } catch (e) { guildsCount = 'err'; }
    } catch (err) {
      dbError = err;
      logger.error('DB health check failed', { error: err.stack || err });
    }
    const sentryStatus = baseLogger.sentry ? '✅ Enabled' : '⚪ Disabled';
    const embed = new EmbedBuilder()
      .setTitle('Bot Health')
      .setColor(dbStatus === '✅ OK' ? 0x00c853 : 0xd32f2f)
      .addFields(
        { name: 'Database', value: dbStatus, inline: true },
        { name: 'Sentry', value: sentryStatus, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: 'DB Info', value: dbInfo || 'n/a', inline: false },
        { name: 'Users', value: usersCount, inline: true },
        { name: 'Guilds', value: guildsCount, inline: true },
        { name: 'Timestamp', value: now.toISOString(), inline: false }
      );
    if (dbError) embed.addFields({ name: 'DB Error', value: String(dbError.message || dbError), inline: false });

    if (detail === 'lastlogs') {
      try {
        const uid = interaction.user && interaction.user.id ? interaction.user.id : 'unknown';
        const last = lastHealthRun.get(uid) || 0;
        const nowTs = Date.now();
        if (nowTs - last < 15000) {
          await require('../../utils/safeReply')(interaction, { content: 'Rate limit: try again in a few seconds.', ephemeral: true }, { loggerName: 'command:health' });
          return;
        }
        lastHealthRun.set(uid, nowTs);
        try { fs.appendFileSync(AUDIT_LOG, `${new Date().toISOString()} health:lastlogs by ${uid}\n`); } catch (e) { }

        const lines = (interaction.options && interaction.options.getInteger && interaction.options.getInteger('lines')) || 50;
        const logsDir = path.join(__dirname, '..', '..', 'logs');
        let chosen = null;
        if (fs.existsSync(logsDir)) {
          const candidates = fs.readdirSync(logsDir).filter(f => f.match(/^application(.*)\.log$/)).map(f => ({ f, m: fs.statSync(path.join(logsDir, f)).mtimeMs }));
          if (candidates.length) { candidates.sort((a, b) => b.m - a.m); chosen = path.join(logsDir, candidates[0].f); }
        }
        if (!chosen) chosen = path.join(__dirname, '..', '..', 'logs', 'application.log');
        if (!fs.existsSync(chosen)) { await require('../../utils/safeReply')(interaction, { content: `No log file found at ${chosen}`, ephemeral: true }, { loggerName: 'command:health' }); return; }
        const content = fs.readFileSync(chosen, 'utf8');
        const allLines = content.split(/\r?\n/).filter(Boolean);
        const tail = allLines.slice(-Math.min(lines, 1000));
        const redact = (s) => {
          if (!s) return s; let out = String(s); const secrets = [process.env.TOKEN, process.env.TOKEN_DEV, process.env.DATABASE_URL, process.env.PG_PASSWORD, process.env.PGPASSWORD]; for (const sec of secrets) if (sec) out = out.split(sec).join('*****'); out = out.replace(/([A-Za-z0-9_\-]{30,})/g, '*****'); return out;
        };
        const redacted = tail.map(redact).join('\n');
        const chunks = [];
        for (let i = 0; i < redacted.length; i += 1900) chunks.push(redacted.slice(i, i + 1900));
        for (const c of chunks) { await require('../../utils/safeReply')(interaction, { content: `\n\n\`\`\`\n${c}\n\`\`\``, ephemeral: true }, { loggerName: 'command:health' }); }
        return;
      } catch (e) {
        logger.warn('lastlogs failed', { error: e && (e.stack || e) });
        await require('../../utils/safeReply')(interaction, { content: 'Failed retrieving logs', ephemeral: true }, { loggerName: 'command:health' });
        return;
      }
    }

    if (detail && detail !== 'summary') {
      try {
        const os = require('os');
        const fs = require('fs');
        const path = require('path');
        const pkg = require('../../../package.json');
        const mem = process.memoryUsage();
        const formatBytes = (b) => (typeof b === 'number' ? `${Math.round(b / 1024 / 1024)} MB` : String(b));
        embed.addFields({ name: 'Node', value: process.version || 'unknown', inline: true });
        embed.addFields({ name: 'Bot Version', value: (pkg && pkg.version) ? String(pkg.version) : 'n/a', inline: true });
        embed.addFields({ name: 'Platform', value: `${os.type()} ${os.arch()} ${os.release()}`, inline: false });
        if (detail === 'full' || detail === 'metrics') {
          embed.addFields(
            { name: 'Uptime', value: `${Math.floor(process.uptime())}s`, inline: true },
            { name: 'Memory (RSS)', value: formatBytes(mem.rss), inline: true },
            { name: 'Heap Used', value: formatBytes(mem.heapUsed), inline: true }
          );
          try { const cpu = process.cpuUsage(); embed.addFields({ name: 'CPU (user)', value: `${cpu.user} μs`, inline: true }); embed.addFields({ name: 'CPU (system)', value: `${cpu.system} μs`, inline: true }); } catch (e) { }
        }

        if (detail === 'full' || detail === 'env') {
          const redact = (k, v) => {
            if (!v && v !== 0) return 'n/a';
            if (/token|secret|password|passwd|key|database|dsn|url/i.test(k)) return '*****';
            const s = String(v);
            if (s.length > 200) return `${s.slice(0, 200)}...`;
            return s;
          };
          const envKeys = Object.keys(process.env).sort();
          const shown = envKeys.slice(0, 25).map(k => `${k}=${redact(k, process.env[k])}`);
          embed.addFields({ name: `Env (showing ${shown.length}/${envKeys.length})`, value: shown.join('\n') || 'none', inline: false });
        }

        if (detail === 'full' || detail === 'db') {
          try { const start = Date.now(); await db.knex.raw('select 1 as result'); const latency = Date.now() - start; embed.addFields({ name: 'DB Ping', value: `${latency} ms`, inline: true }); } catch (e) { embed.addFields({ name: 'DB Ping', value: `failed: ${e && e.message ? e.message : String(e)}`, inline: true }); }
          try { const migrationsExists = await db.knex.schema.hasTable('knex_migrations'); if (migrationsExists) { const m = await db.knex('knex_migrations').count('* as c').first(); embed.addFields({ name: 'Migrations', value: String(m && (m.c || m['count(*)']) || '0'), inline: true }); } } catch (e) { }
          try { const fallbackPath = path.join(__dirname, '..', '..', 'logs', 'fallback.log'); if (fs.existsSync(fallbackPath)) { const st = fs.statSync(fallbackPath); embed.addFields({ name: 'Fallback log', value: `${st.size} bytes`, inline: true }); } } catch (e) { }
        }
      } catch (e) { try { logger.warn('Failed building full health details', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('health full build failed', le && (le.stack || le)); } catch (ignored) {} } }
    }
    const safeReply = require('../../utils/safeReply');
    await safeReply(interaction, { embeds: [embed], ephemeral: true }, { loggerName: 'command:health' });
  }
};
