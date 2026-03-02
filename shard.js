require('dotenv').config();
const path = require('path');
const { ShardingManager } = require('discord.js');
const baseLogger = require('./src/utils/logger');
const logger = baseLogger.get('sharding');

// Get token
const token = process.env.TOKEN;
if (!token) {
  logger.error('Missing TOKEN environment variable');
  process.exit(1);
}

// Create shard manager
// Auto-calculates shard count based on bot's gateway connection
const manager = new ShardingManager(path.join(__dirname, 'src', 'index.js'), {
  token: token,
  respawn: true,
  // Auto-fetch the recommended shard count from Discord
  autoFetch: true,
  // Spawn all shards at once (fast startup)
  shardList: 'auto',
  // Allow 10 seconds per shard spawn to avoid rate limiting
  shardArgs: ['--shard'],
  totalShards: 'auto',
  // Keep shards alive if they crash
  handleSignals: true,
  // Allow graceful restarts
  mode: 'worker'
});

manager.on('shardCreate', shard => {
  logger.info('Shard created', { shardId: shard.id });
  
  shard.on('ready', () => {
    logger.info('Shard ready', { shardId: shard.id, guilds: shard.guilds.cache.size });
  });
  
  shard.on('error', error => {
    logger.error('Shard error', { shardId: shard.id, error: error && (error.stack || error) });
  });
  
  shard.on('disconnect', () => {
    logger.warn('Shard disconnected', { shardId: shard.id });
  });
  
  shard.on('reconnecting', () => {
    logger.info('Shard reconnecting', { shardId: shard.id });
  });
});

manager.spawn().then(() => {
  logger.info('All shards spawned successfully', { totalShards: manager.totalShards });
}).catch(err => {
  logger.error('Failed to spawn shards', { error: err && (err.stack || err) });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('ShardingManager received SIGINT, shutting down gracefully');
  try {
    await manager.broadcastEval((client) => client.destroy());
    process.exit(0);
  } catch (e) {
    logger.error('Error during graceful shutdown', { error: e && (e.stack || e) });
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('ShardingManager received SIGTERM, shutting down gracefully');
  try {
    await manager.broadcastEval((client) => client.destroy());
    process.exit(0);
  } catch (e) {
    logger.error('Error during graceful shutdown', { error: e && (e.stack || e) });
    process.exit(1);
  }
});
