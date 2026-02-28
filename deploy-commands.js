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
const profile = process.env.BOT_PROFILE || (process.env.NODE_ENV === 'development' ? 'dev' : 'public');
let clientId = process.env.CLIENT_ID;
let token = process.env.TOKEN;
try {
  const profilePath = path.join(__dirname, 'config', `bot.${profile}.json`);
  if (fs.existsSync(profilePath)) {
  const profileCfg = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
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
    console.log('Refreshing application (/) commands...');
    // Priority: if GUILD_ID is set, register to that guild first for fast testing.
    // Always attempt global registration afterwards (best-effort); failures are logged but do not abort.
    const targetGuild = process.env.GUILD_ID;
    if (targetGuild) {
      logger.info('Registering guild commands', { clientId, guildId: targetGuild });
      await rest.put(Routes.applicationGuildCommands(clientId, targetGuild), { body: commands });
      console.log('Successfully registered guild commands.');
    }
    try {
      // By default do not register global commands to avoid accidental duplication.
      // To allow global registration set `ALLOW_GLOBAL_REGISTRATION=true` in env.
      const allowGlobal = process.env.ALLOW_GLOBAL_REGISTRATION === 'true';
      if (!allowGlobal) {
        logger.info('Global registration disabled by default; set ALLOW_GLOBAL_REGISTRATION=true to enable', { profile });
      } else {
        logger.info('Registering global commands (best-effort)', { clientId });
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Successfully registered global commands.');
      }
    } catch (globalErr) {
      logger.warn('Global command registration failed (best-effort)', { error: globalErr && (globalErr.stack || globalErr) });
    }
  } catch (error) {
    console.error(error);
  }
})();
