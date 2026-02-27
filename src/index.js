const fs = require('fs');
const path = require('path');
require('dotenv').config();
// Determine which bot profile to use (public vs dev). Priority:
// 1) process.env.BOT_PROFILE, 2) NODE_ENV === 'production' => public, otherwise dev
const profile = (process.env.BOT_PROFILE && String(process.env.BOT_PROFILE).toLowerCase())
  || (process.env.NODE_ENV === 'production' ? 'public' : 'dev');
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
  // eslint-disable-next-line no-console
  console.warn('Failed to load bot profile config', e && (e.stack || e));
}

// Basic env validation: ensure required secrets are present
const requiredEnvs = ['TOKEN'];
const missing = requiredEnvs.filter(k => !process.env[k]);
if (missing.length > 0) {
  // Fail fast — bot cannot run without a token
  // Log via console because logger not yet configured
  // Use process.exit to avoid starting a bot with missing credentials
  // Provide helpful hint
  // eslint-disable-next-line no-console
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}


const baseLogger = require('./utils/logger');
const logger = baseLogger.get('index');

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

// Database (knex) — initialize and run migrations in dev

if (process.env.NODE_ENV !== 'production') {
  db.migrate().catch(err => baseLogger.error('DB migrate failed', { error: err.stack || err }));
}

// Ensure all eggs from config are present in the database for all guilds
const eggTypes = require('../config/eggTypes.json');
const eggModel = require('./models/egg');
eggModel.ensureAllEggsInAllGuilds(eggTypes, db.knex).catch(err => baseLogger.error('Failed to ensure all eggs in DB', { error: err.stack || err }));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.commands = new Collection();
client.config = config;

// Load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (!command.name) continue;
      client.commands.set(command.name, command);
      logger.info('Loaded command', { command: command.name });
    } catch (err) {
      logger.error('Failed loading command file', { file, error: err.stack || err });
    }
  }
  logger.info('Commands loaded', { count: client.commands.size });
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

      logger.info('Loaded event', { event: event.name, registeredAs: registeredName });
    } catch (err) {
      logger.error('Failed loading event file', { file, error: err.stack || err });
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
 
client.login(process.env.TOKEN).then(() => {
  logger.info('Login initiated');
}).catch(err => {
  logger.error('Failed to login', { error: err.stack || err });
  process.exit(1);
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

