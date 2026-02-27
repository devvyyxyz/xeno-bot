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

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Refreshing application (/) commands...');
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
      console.log('Successfully registered guild commands.');
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('Successfully registered global commands.');
    }
  } catch (error) {
    console.error(error);
  }
})();
