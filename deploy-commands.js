require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const baseLogger = require('./src/utils/logger');
const logger = baseLogger.get('deploy-commands');

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
const { getCommandsObject } = require('./src/utils/commandsConfig');
const commandsConfig = getCommandsObject() || {};
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) commands.push(command.data);

    // warn if config name differs from exported name
    const key = path.basename(file, '.js');
    const exportedName = command.name || (command.data && command.data.name);
    // find config entry for this command across categories
    let cfg = null;
    let foundCategory = null;
    for (const [catName, catObj] of Object.entries(commandsConfig || {})) {
      if (catObj && Object.prototype.hasOwnProperty.call(catObj, key)) { cfg = catObj[key]; foundCategory = catName; break; }
    }
    if (cfg && cfg.name && exportedName && cfg.name !== exportedName) {
      logger.warn(`commands.json mismatch for ${foundCategory}/${key}`, { category: foundCategory, key, configName: cfg.name, exportedName });
    }
  }

  // Validate commands.json entries have corresponding command modules
  const existingKeys = new Set(commandFiles.map(f => path.basename(f, '.js')));
  for (const [category, catObj] of Object.entries(commandsConfig || {})) {
    if (!catObj || typeof catObj !== 'object') continue;
    for (const cmdKey of Object.keys(catObj)) {
      if (!existingKeys.has(cmdKey)) {
        logger.warn(`commands.json entry missing module: ${category}/${cmdKey}`, { category, key: cmdKey });
      }
    }
  }
}

// Determine bot profile and token/client selection
// Priority: BOT_PROFILE env var, then npm lifecycle event (script name), then NODE_ENV
const explicitProfile = process.env.BOT_PROFILE && String(process.env.BOT_PROFILE).toLowerCase();
let inferredProfile = null;
if (process.env.npm_lifecycle_event) {
  const ev = String(process.env.npm_lifecycle_event).toLowerCase();
  if (ev.includes('dev') || ev.includes('start:dev') || ev === 'dev') inferredProfile = 'dev';
  else inferredProfile = 'public';
}
// Accept `dev` as a CLI arg (e.g. `npm start dev`) forwarded by npm
if (!inferredProfile && process.argv && process.argv.length > 2) {
  const hasDevArg = process.argv.slice(2).some(a => /(^|\W)(dev|development)(\W|$)/i.test(String(a)));
  if (hasDevArg) inferredProfile = 'dev';
}
const profile = explicitProfile || inferredProfile || (process.env.NODE_ENV === 'development' ? 'dev' : 'public');
let clientId = process.env.CLIENT_ID;
let token = process.env.TOKEN;
let profileCfg = null;
try {
  const profilePath = path.join(__dirname, 'config', `bot.${profile}.json`);
  if (fs.existsSync(profilePath)) {
    profileCfg = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    // prefer the profile's configured clientId when present
    clientId = profileCfg.clientId || clientId;
    const tokenEnvVar = profileCfg.tokenEnvVar || 'TOKEN';
    token = process.env[tokenEnvVar] || token;
    logger.info('Using bot profile', { profile, clientId, tokenEnvVar });
  } else {
    logger.info('Bot profile file not found, falling back to env vars', { profile });
  }
} catch (e) {
  logger.warn('Failed to load bot profile config; using env vars', { profile, error: e && (e.stack || e) });
}

if (!token) {
  console.error('No bot token found in environment. Set TOKEN or the profile-specific token env var.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    // If requested, clear global (application) commands for the selected client and exit.
    // This is useful to remove previously-registered global commands that should no longer exist.
    if (process.env.CLEAR_GLOBAL_COMMANDS === 'true') {
      logger.info('CLEAR_GLOBAL_COMMANDS requested — clearing global commands for client', { clientId });
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log('Cleared global commands for client', clientId);
      return;
    }

    // Likewise, allow clearing a specific guild's commands via CLEAR_GUILD_COMMANDS=true and GUILD_ID
    if (process.env.CLEAR_GUILD_COMMANDS === 'true') {
      const guildToClear = process.env.GUILD_ID || (profileCfg && profileCfg.guildId);
      if (!guildToClear) {
        logger.warn('CLEAR_GUILD_COMMANDS requested but no GUILD_ID or profile guildId found');
      } else {
        logger.info('Clearing guild commands', { clientId, guildId: guildToClear });
        await rest.put(Routes.applicationGuildCommands(clientId, guildToClear), { body: [] });
        console.log('Cleared guild commands for', guildToClear);
      }
      return;
    }

    console.log('Refreshing application (/) commands...');
    // Priority: if GUILD_ID is set, register to that guild first for fast testing.
    // Also allow the profile file to specify a default guildId (useful for dev profile).
    // IMPORTANT SAFETY: dev profile should NEVER register global commands.
    const targetGuild = process.env.GUILD_ID || (profileCfg && profileCfg.guildId);
    const isDevProfile = profile === 'dev';
    if (targetGuild) {
      logger.info('Registering guild commands', { clientId, guildId: targetGuild, profile });
      await rest.put(Routes.applicationGuildCommands(clientId, targetGuild), { body: commands });
      console.log('Successfully registered guild commands.');
    } else if (isDevProfile) {
      logger.warn('Dev profile selected but no GUILD_ID configured; skipping registration to avoid global registration', { profile });
    }

    // Only attempt global registration for non-dev profiles and only when explicitly allowed.
    if (!isDevProfile) {
      try {
        const allowGlobal = process.env.ALLOW_GLOBAL_REGISTRATION === 'true';
        if (!allowGlobal) {
          logger.info('Global registration disabled by default; set ALLOW_GLOBAL_REGISTRATION=true to enable', { profile });
        } else {
          logger.info('Registering global commands (best-effort)', { clientId, profile });
          await rest.put(Routes.applicationCommands(clientId), { body: commands });
          console.log('Successfully registered global commands.');
        }
      } catch (globalErr) {
        logger.warn('Global command registration failed (best-effort)', { error: globalErr && (globalErr.stack || globalErr) });
      }
    }
  } catch (error) {
    console.error(error);
  }
})();
