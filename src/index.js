const fs = require('fs');
const path = require('path');
require('dotenv').config();
// ...existing code...


const baseLogger = require('./utils/logger');
const logger = baseLogger.get('index');

const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../config/config.json');
// Sentry (optional): capture crashes/telemetry when SENTRY_DSN is set
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
    baseLogger.info('Sentry initialized', { env: process.env.NODE_ENV });
    // Attach Sentry to baseLogger for convenience
    baseLogger.sentry = Sentry;
  } catch (err) {
    baseLogger.error('Failed to initialize Sentry', { error: err.stack || err });
  }
}

// Database adapter (knex). Exposes `migrate()` to prepare local DB during startup.
const { knex, migrate } = require('./db');
// Optional telemetry (Sentry)
let Sentry;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
    baseLogger.info('Sentry initialized');
  } catch (err) {
    baseLogger.error('Failed to initialize Sentry', { error: err.stack || err });
  }
}

// Database (knex) — initialize and run migrations in dev

if (process.env.NODE_ENV !== 'production') {
  migrate().catch(err => baseLogger.error('DB migrate failed', { error: err.stack || err }));
}

// Ensure all eggs from config are present in the database for all guilds
const eggTypes = require('../config/eggTypes.json');
const eggModel = require('./models/egg');
eggModel.ensureAllEggsInAllGuilds(eggTypes, knex).catch(err => baseLogger.error('Failed to ensure all eggs in DB', { error: err.stack || err }));

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

