const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
require('dotenv').config();
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
if (!token || !clientId) {
  console.error('Missing TOKEN or CLIENT_ID env vars');
  process.exit(2);
}
const rest = new REST({ version: '10' }).setToken(token);
(async () => {
  try {
    const cmds = await rest.get(Routes.applicationCommands(clientId));
    console.log('Global commands count:', cmds.length);
    console.log(cmds.map(c => c.name).sort().join('\n'));
  } catch (e) {
    console.error('Failed fetching global commands:', e && (e.stack || e));
    process.exit(1);
  }
})();
