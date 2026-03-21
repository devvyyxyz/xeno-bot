require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const baseLogger = console;

async function loadCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, '..', 'src', 'commands');
  const { getCommandsObject } = require('../src/utils/commandsConfig');
  const commandsConfig = getCommandsObject() || {};

  const isCommandCategory = (catObj) => {
    if (!catObj || typeof catObj !== 'object' || Array.isArray(catObj)) return false;
    const values = Object.values(catObj);
    if (values.length === 0) return false;
    return values.some(v => v && typeof v === 'object' && (Object.prototype.hasOwnProperty.call(v, 'name') || Object.prototype.hasOwnProperty.call(v, 'description')));
  };

  const commandCategories = Object.entries(commandsConfig || {}).filter(([, catObj]) => isCommandCategory(catObj));

  if (fs.existsSync(commandsPath)) {
    try {
      const loader = require(path.join(__dirname, '..', 'src', 'commands', 'loader'));
      const loaded = loader.loadCommands(commandsPath);
      const existingKeys = new Set();
      for (const [name, command] of loaded) {
        existingKeys.add(name);
        if (command && command.data) {
          const d = (typeof command.data.toJSON === 'function') ? command.data.toJSON() : command.data;
          commands.push(d);
        }
      }

      // Validate commands.json entries have corresponding command modules
      for (const [category, catObj] of commandCategories) {
        for (const cmdKey of Object.keys(catObj)) {
          if (!existingKeys.has(cmdKey)) {
            baseLogger.warn(`commands.json entry missing module: ${category}/${cmdKey}`);
          }
        }
      }
    } catch (e) {
      baseLogger.warn('Failed to load commands via loader; falling back to flat-scan', e && (e.stack || e));
      const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
      for (const file of commandFiles) {
        try {
          const command = require(path.join(commandsPath, file));
          if (command.data) commands.push((typeof command.data.toJSON === 'function') ? command.data.toJSON() : command.data);
        } catch (innerErr) {
          baseLogger.warn('Failed to require command during fallback deploy scan', file, innerErr && (innerErr.stack || innerErr));
        }
      }
    }
  }
  return commands;
}

function putToTopgg(topggToken, commands) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const opts = {
      hostname: 'top.gg',
      path: `/api/v1/projects/@me/commands`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${topggToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    baseLogger.info('top.gg commands request', { path: opts.path, commandCount: commands.length });

    const req = https.request(opts, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        const code = res.statusCode || 0;
        if (code >= 200 && code < 300) {
          baseLogger.info('top.gg commands response', { status: code });
          resolve({ status: code, body: raw });
        } else {
          baseLogger.error('top.gg commands response error', { status: code, headers: res.headers, body: raw ? raw.slice(0, 10000) : raw });
          const err = new Error(`top.gg commands API returned ${code}: ${raw}`);
          err.status = code;
          err.headers = res.headers;
          err.body = raw;
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      baseLogger.error('top.gg commands request error', err && (err.stack || err));
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

function fetchGuildCount(discordToken) {
  return new Promise((resolve, reject) => {
    const fetchPage = (after, accumulated) => {
      const query = new URLSearchParams({ limit: '200' });
      if (after) query.set('after', after);

      const opts = {
        hostname: 'discord.com',
        path: `/api/v10/users/@me/guilds?${query.toString()}`,
        method: 'GET',
        headers: {
          'Authorization': `Bot ${discordToken}`,
        },
      };

      const req = https.request(opts, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => raw += chunk);
        res.on('end', () => {
          const code = res.statusCode || 0;
          if (code !== 200) {
            const err = new Error(`Discord API returned ${code}: ${raw}`);
            err.status = code;
            return reject(err);
          }
          let guilds;
          try { guilds = JSON.parse(raw); } catch (e) { return reject(e); }
          const total = accumulated + guilds.length;
          if (guilds.length === 200) {
            // More pages — continue from last guild ID
            fetchPage(guilds[guilds.length - 1].id, total);
          } else {
            resolve(total);
          }
        });
      });

      req.on('error', reject);
      req.end();
    };

    fetchPage(null, 0);
  });
}

function postBotStats(clientId, topggToken, serverCount, shardCount) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      server_count: serverCount,
      ...(shardCount != null && { shard_count: shardCount }),
    });

    const opts = {
      hostname: 'top.gg',
      path: `/api/bots/${encodeURIComponent(clientId)}/stats`,
      method: 'POST',
      headers: {
        'Authorization': topggToken, // v0 — no Bearer prefix
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    baseLogger.info('top.gg stats request', { path: opts.path, serverCount, shardCount });

    const req = https.request(opts, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        const code = res.statusCode || 0;
        if (code >= 200 && code < 300) {
          baseLogger.info('top.gg stats response', { status: code });
          resolve({ status: code, body: raw });
        } else {
          baseLogger.error('top.gg stats response error', { status: code, body: raw ? raw.slice(0, 10000) : raw });
          const err = new Error(`top.gg stats API returned ${code}: ${raw}`);
          err.status = code;
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      baseLogger.error('top.gg stats request error', err && (err.stack || err));
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const clientId     = process.env.CLIENT_ID;
    const topggToken   = process.env.TOPGG_TOKEN || process.env.TOPGG_API_TOKEN;
    const discordToken = process.env.TOKEN || process.env.BOT_TOKEN;

    if (!clientId) {
      baseLogger.error('CLIENT_ID not set in environment. Set CLIENT_ID to your bot application id.');
      process.exit(1);
    }
    if (!topggToken) {
      baseLogger.error('TOPGG_TOKEN not set in environment. Set TOPGG_TOKEN to your top.gg project token.');
      process.exit(1);
    }

    // --- Update commands ---
    baseLogger.info('Loading commands...');
    const commands = await loadCommands();
    if (!commands || !commands.length) {
      baseLogger.warn('No commands found to send to top.gg');
    } else {
      baseLogger.info(`Sending ${commands.length} commands to top.gg...`);
      await putToTopgg(topggToken, commands);
      baseLogger.info('top.gg commands update successful');
    }

    // --- Update bot stats ---
    const shardCount = process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT, 10) : null;

    if (!discordToken) {
      baseLogger.warn('DISCORD_TOKEN not set — skipping stats update');
    } else {
      baseLogger.info('Fetching guild count from Discord API...');
      const serverCount = await fetchGuildCount(discordToken);
      baseLogger.info(`Guild count: ${serverCount}`);
      baseLogger.info(`Posting stats to top.gg — servers: ${serverCount}${shardCount != null ? `, shards: ${shardCount}` : ''}`);
      await postBotStats(clientId, topggToken, serverCount, shardCount);
      baseLogger.info('top.gg stats update successful');
    }

    process.exit(0);
  } catch (e) {
    baseLogger.error('Failed to update top.gg', e && (e.stack || e));
    process.exit(1);
  }
})();