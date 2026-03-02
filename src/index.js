const fs = require('fs');
const path = require('path');
require('dotenv').config();
const baseLogger = require('./utils/logger');
const logger = baseLogger.get('index');
// Route any remaining `console.warn` / `console.error` fallbacks to a
// file-backed fallback logger. This prevents raw stdout writes from
// appearing in production logs if the main logger fails.
try {
  const fallback = require('./utils/fallbackLogger');
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...args) => {
    try {
      const msg = args.map(a => (typeof a === 'string' ? a : (a && a.stack) || String(a))).join(' ');
      fallback.warn(msg);
    } catch (e) {
      origWarn(...args);
    }
  };
  console.error = (...args) => {
    try {
      const msg = args.map(a => (typeof a === 'string' ? a : (a && a.stack) || String(a))).join(' ');
      fallback.error(msg);
    } catch (e) {
      origError(...args);
    }
  };
} catch (e) {
  // ignore if fallback logger cannot be loaded
}
// Determine which bot profile to use (public vs dev). Priority:
// 1) process.env.BOT_PROFILE
// 2) npm script name (process.env.npm_lifecycle_event) when available (helps hosts using `npm start` vs `npm run start:dev`)
// 3) NODE_ENV === 'production' => public, otherwise dev
const explicit = process.env.BOT_PROFILE && String(process.env.BOT_PROFILE).toLowerCase();
let inferred = null;
// Infer from npm lifecycle event when available (script name)
if (process.env.npm_lifecycle_event) {
  const ev = String(process.env.npm_lifecycle_event).toLowerCase();
  if (ev.includes('dev') || ev.includes('start:dev') || ev === 'dev') inferred = 'dev';
  else inferred = 'public';
}
// Also accept a plain 'dev' CLI arg (e.g. `npm start dev`) or `--dev` flag passed through npm
if (!inferred && process.argv && process.argv.length > 2) {
  const hasDevArg = process.argv.slice(2).some(a => /(^|\W)(dev|development)(\W|$)/i.test(String(a)));
  if (hasDevArg) inferred = 'dev';
}
const profile = explicit || inferred || (process.env.NODE_ENV === 'production' ? 'public' : 'dev');
// Load non-secret metadata for chosen profile and map token env var into process.env.TOKEN if available.
try {
  const botCfgPath = path.join(__dirname, '..', 'config', `bot.${profile}.json`);
  if (fs.existsSync(botCfgPath)) {
    const botCfg = require(botCfgPath);
    // If the profile specifies a tokenEnvVar, prefer that env var, falling back to existing TOKEN.
    if (botCfg && botCfg.tokenEnvVar) {
      const tokenFromProfileEnv = process.env[botCfg.tokenEnvVar];
      if (tokenFromProfileEnv) process.env.TOKEN = tokenFromProfileEnv;
    }
    // expose the selected bot profile metadata for runtime modules
    process.env.BOT_PROFILE = profile;
    process.env.BOT_CONFIG_PATH = botCfgPath;
  }
} catch (e) {
  baseLogger.warn('Failed to load bot profile config', { error: e && (e.stack || e) });
}

// Basic env validation: ensure required secrets are present
const requiredEnvs = ['TOKEN'];
const missing = requiredEnvs.filter(k => !process.env[k]);
if (missing.length > 0) {
  // Fail fast — bot cannot run without a token
  // Log via console because logger not yet configured
  // Use process.exit to avoid starting a bot with missing credentials
  // Provide helpful hint
  baseLogger.error('Missing required environment variables', { missing: missing.join(', ') });
  process.exit(1);
}


// (logger already initialized above)

const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../config/config.json');
// Database adapter (knex). Exposes `migrate()` to prepare local DB during startup.
const db = require('./db');
// Optional telemetry (Sentry) — validate DSN and initialize once
let Sentry;
if (process.env.SENTRY_DSN) {
  try {
    const SentryLib = require('@sentry/node');
    SentryLib.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
    Sentry = SentryLib;
    baseLogger.info('Sentry initialized', { env: process.env.NODE_ENV });
    baseLogger.sentry = Sentry;
  } catch (err) {
    baseLogger.warn('Invalid Sentry DSN or failed to initialize Sentry; continuing without Sentry', { error: err && (err.stack || err) });
    Sentry = null;
  }
}

// Perform DB migrations and ensure egg stats before starting the bot.
const eggTypes = require('../config/eggTypes.json');
const eggModel = require('./models/egg');
const childProcess = require('child_process');

function createStartupProgress(totalSteps) {
  let completed = 0;
  const startedAt = Date.now();
  const width = 20;

  const render = (label, state) => {
    const ratio = totalSteps > 0 ? completed / totalSteps : 0;
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    const empty = width - filled;
    const percent = Math.round(ratio * 100);
    const bar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
    baseLogger.info(`[startup] [${bar}] ${percent}% (${completed}/${totalSteps}) ${state} - ${label}`);
  };

  return {
    async runStep(label, fn) {
      render(label, 'RUNNING');
      const stepStart = Date.now();
      try {
        const result = await fn();
        completed += 1;
        render(label, `DONE (${Date.now() - stepStart}ms)`);
        return result;
      } catch (err) {
        completed += 1;
        render(label, `FAILED (${Date.now() - stepStart}ms)`);
        throw err;
      }
    },
    finish() {
      const totalMs = Date.now() - startedAt;
      baseLogger.info('[startup] All startup tasks completed', { totalMs, completed, totalSteps });
    }
  };
}

async function startup() {
  const startupProgress = createStartupProgress(4);

  try {
    await startupProgress.runStep('Database migration', async () => {
      try {
        await db.migrate();
        baseLogger.info('DB migrate complete');
      } catch (err) {
        baseLogger.error('DB migrate failed', { error: err.stack || err });
        // Continue — migrate() already falls back to SQLite on connection refusal
      }
    });

    await startupProgress.runStep('Egg stats synchronization', async () => {
      try {
        await eggModel.ensureAllEggsInAllGuilds(eggTypes, db.knex);
        baseLogger.info('Egg stats ensured in DB');
      } catch (err) {
        baseLogger.error('Failed to ensure all eggs in DB', { error: err.stack || err });
      }
    });

    await startupProgress.runStep('Command auto-deploy checks', async () => {
      // Optionally auto-deploy dev guild commands when developing locally.
      // Unified auto-deploy behavior:
      // - If running the public bot via `npm start` -> register/update global commands for public bot.
      // - If running the dev bot via `npm start dev` or `npm run start:dev` -> register/update dev guild commands only.
      try {
        const isDevProfile = process.env.BOT_PROFILE === 'dev' || profile === 'dev' || (process.argv && process.argv.slice(2).some(a => /(^|\W)(dev|development)(\W|$)/i.test(String(a))));
        const isPublicProfile = !isDevProfile;

        const lifecycle = process.env.npm_lifecycle_event ? String(process.env.npm_lifecycle_event).toLowerCase() : null;

        const shouldAutoDeployDev = isDevProfile && (
          lifecycle === 'start:dev' || lifecycle === 'dev' || lifecycle === 'start' && process.argv.slice(2).some(a => /(^|\W)(dev|development)(\W|$)/i.test(String(a))) || process.env.DEV_AUTO_DEPLOY === 'true'
        );

        const shouldAutoDeployPublic = isPublicProfile && (
          lifecycle === 'start' || process.env.AUTO_DEPLOY_PUBLIC === 'true'
        );

        const guildToUse = process.env.GUILD_ID || (process.env.BOT_CONFIG_PATH ? (() => {
          try { const pc = require(process.env.BOT_CONFIG_PATH); return pc && pc.guildId; } catch (_) { return null; }
        })() : null);

        const deployChild = async (envOverrides = {}) => {
          try {
            const node = process.execPath || 'node';
            const deployPath = path.join(__dirname, '..', 'deploy-commands.js');
            const env = Object.assign({}, process.env, envOverrides);
            const res = childProcess.spawnSync(node, [deployPath], { env, stdio: 'inherit' });
            if (res.error) baseLogger.warn('Auto-deploy child process failed to start', { error: String(res.error) });
            else if (res.status !== 0) baseLogger.warn('Auto-deploy child process exited non-zero', { status: res.status });
            else baseLogger.info('Auto-deploy completed successfully');
          } catch (e) {
            baseLogger.warn('Auto-deploy failed', { error: e && (e.stack || e) });
          }
        };

        if (shouldAutoDeployDev) {
          if (!guildToUse) baseLogger.warn('Dev auto-deploy requested but no GUILD_ID/profile.guildId found; skipping dev deploy');
          else {
            baseLogger.info('Auto-deploying dev guild commands', { guild: guildToUse });
            await deployChild({ BOT_PROFILE: 'dev', GUILD_ID: guildToUse });
          }
        }

        if (shouldAutoDeployPublic) {
          baseLogger.info('Auto-deploying public global commands');
          await deployChild({ BOT_PROFILE: 'public', ALLOW_GLOBAL_REGISTRATION: 'true' });
        }
      } catch (e) {
        baseLogger.warn('Auto-deploy check failed', { error: e && (e.stack || e) });
      }

      // Optionally auto-deploy public/global commands on the host when explicitly enabled.
      try {
        const autoPublic = process.env.AUTO_DEPLOY_PUBLIC === 'true';
        const isPublic = process.env.BOT_PROFILE === 'public' || profile === 'public';
        if (autoPublic && isPublic) {
          baseLogger.info('AUTO_DEPLOY_PUBLIC enabled — running deploy-commands for public profile (global)', { profile });
          try {
            const node = process.execPath || 'node';
            const deployPath = path.join(__dirname, '..', 'deploy-commands.js');
            const env = Object.assign({}, process.env, { BOT_PROFILE: 'public', ALLOW_GLOBAL_REGISTRATION: 'true' });
            const res = childProcess.spawnSync(node, [deployPath], { env, stdio: 'inherit' });
            if (res.error) baseLogger.warn('Auto-deploy-public child process failed to start', { error: String(res.error) });
            else if (res.status !== 0) baseLogger.warn('Auto-deploy-public child process exited non-zero', { status: res.status });
            else baseLogger.info('Auto-deploy-public completed successfully');
          } catch (e) {
            baseLogger.warn('Auto-deploy-public failed', { error: e && (e.stack || e) });
          }
        }
      } catch (e) {
        baseLogger.warn('AUTO_DEPLOY_PUBLIC check failed', { error: e && (e.stack || e) });
      }
    });

    await startupProgress.runStep('Discord login', async () => {
      await client.login(process.env.TOKEN);
      logger.info('Login initiated');
    });

    startupProgress.finish();
  } catch (err) {
    logger.error('Startup failed', { error: err && (err.stack || err) });
    process.exit(1);
  }
}

// Create client BEFORE startup so it's available in startup()
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.commands = new Collection();
client.config = config;

// Start async startup tasks (now client exists)
startup();

// Start background workers after the client is ready
try {
  const evolutionWorker = require('./evolutionWorker');
  client.once('clientReady', () => {
    try { evolutionWorker.start(client).catch(e => logger.warn('Failed starting evolution worker', { error: e && (e.stack || e) })); } catch (e) { logger.warn('Failed to invoke evolutionWorker.start', { error: e && (e.stack || e) }); }
  });
} catch (e) {
  logger.warn('evolutionWorker module not available', { error: e && (e.stack || e) });
}

// Load commands (support both flat files and directory-based commands)
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  try {
    const loader = require('./commands/loader');
    const loaded = loader.loadCommands(commandsPath);
    for (const [name, cmd] of loaded) {
      client.commands.set(name, cmd);
      logger.info(`Loaded command ${name}`, { command: name });
    }
    logger.info('Commands loaded', { count: client.commands.size, commands: Array.from(client.commands.keys()).sort() });
  } catch (err) {
    logger.error('Failed loading commands via loader', { error: err && (err.stack || err) });
  }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
  for (const file of eventFiles) {
    try {
      const event = require(path.join(eventsPath, file));
      const handler = (...args) => event.execute(...args, client);
      // Register `clientReady` instead of `ready` to avoid deprecation warning.
      const registeredName = event.name === 'ready' ? 'clientReady' : event.name;
      if (event.once) client.once(registeredName, handler);
      else client.on(registeredName, handler);

      logger.info(`Loaded event ${event.name}`, { file, registeredAs: registeredName });
    } catch (err) {
      logger.error(`Failed loading event file: ${file}`, { file, error: err.stack || err });
    }
  }
  logger.info('Events loaded', { count: (fs.existsSync(eventsPath) && fs.readdirSync(eventsPath).filter(f => f.endsWith('.js')).length) || 0 });
}

// Global error handlers
process.on('uncaughtException', (err) => {
  baseLogger.error('Uncaught Exception', { error: err.stack || err });
  if (baseLogger.sentry) baseLogger.sentry.captureException(err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  baseLogger.error('Unhandled Rejection', { reason: reason && (reason.stack || reason) });
  if (baseLogger.sentry) baseLogger.sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});
 

// Graceful shutdown: try to clean up managers and DB before exit
async function gracefulShutdown(reason) {
  try {
    logger.info('Graceful shutdown starting', { reason });
    // call optional shutdown hooks if modules expose them
    try {
      const spawnManager = require('./spawnManager');
      if (typeof spawnManager.shutdown === 'function') await spawnManager.shutdown();
    } catch (e) { logger.warn('spawnManager.shutdown not available', { error: e && (e.stack || e) }); }
    try {
      const hatchManager = require('./hatchManager');
      if (typeof hatchManager.shutdown === 'function') await hatchManager.shutdown();
    } catch (e) { logger.warn('hatchManager.shutdown not available', { error: e && (e.stack || e) }); }
    try { await db.knex.destroy(); } catch (e) { logger.warn('Failed to destroy knex', { error: e && (e.stack || e) }); }
    logger.info('Graceful shutdown complete, exiting');
    process.exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown', { error: err && (err.stack || err) });
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

