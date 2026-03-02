# Discord Bot Sharding Guide

This bot supports Discord.js v14 sharding for handling large bot deployments across multiple Discord gateway connections.

## What is Sharding?

Sharding is a technique that splits your bot's load across multiple processes, each managing a subset of your bot's guilds. This allows your bot to:

- **Scale to larger guild counts**: Discord limits ~2500 guilds per connection
- **Handle more concurrent operations**: Each shard has its own connection, RateLimits, and memory
- **Improve stability**: If one shard fails, others continue operating
- **Reduce memory footprint per process**: Each shard uses less memory than one monolithic bot

## When to Use Sharding

- **Bot is in 2000+ servers**: Sharding becomes essential for stability
- **High command volume across guilds**: Spreads load across multiple processes
- **Bot needs 99.9% uptime**: Shard redundancy improves availability
- **Running in production**: **Default now** - `npm start` uses sharding automatically
- **Confident in your setup**: Sharding adds operational complexity

## When NOT to Use Sharding

- **Bot is in <500 servers**: Single process is sufficient
- **Development/testing**: Use `npm run dev` (non-sharded)
- **Troubleshooting issues**: Easier to debug with `npm run start:single`
- **Limited resources**: Each shard uses memory; single process may be more efficient for very small bots

## Running with Sharding

### Production (Sharded - Default)
```bash
npm start
```

This is the default production command and automatically uses sharding. It will:
1. Start the ShardingManager (main process)
2. Auto-fetch the recommended shard count from Discord
3. Spawn all shards as worker processes
4. Handle respawning failed shards
5. Display shard information in logs

### Production (Single Process - Non-Sharded)
```bash
npm run start:single
```

Use this for smaller deployments (<2000 guilds) or if you don't need sharding.

### Shorthand for Sharded Mode
```bash
npm run start:shards
```

This is equivalent to `npm start` but explicit about sharding.

### Development (Sharded)
```bash
npm run dev:shards
```

Sharded development mode with `NODE_ENV=development`.

### Development (Single Process - Default)
```bash
npm run dev
```

Default development mode without sharding. Perfect for testing without shard complexity.

## Shard Information Display

The bot automatically displays cycling status messages showing:

1. **Member Count**: How many total Discord users the bot is managing
   ```
   🎮 Watching 150,432 members
   ```

2. **Server Count**: How many Discord servers the bot is in
   ```
   🎮 Watching 2,847 servers
   ```

3. **Shard Info** (when sharded): Which shard the bot is running on
   ```
   🎮 Playing Shard 2/7
   ```

The `/ping` command also shows which shard your current server is on:
```
## Pong!
Bot: 45ms • API: 120ms
📍 Shard 2/7
```

## Configuration

### Automatic Shard Count
The ShardingManager automatically fetches the recommended shard count from Discord based on your bot's load and gateway connection size. You don't need to configure this manually.

To override (not recommended):
```javascript
// In shard.js, modify the manager creation:
const manager = new ShardingManager(path.join(__dirname, 'src', 'index.js'), {
  token: token,
  totalShards: 4,  // Override automatic calculation
  // ... rest of config
});
```

### Environment Variables

- `TOKEN`: Your Discord bot token (required)
- `NODE_ENV=production|development`: Environment mode
- `SENTRY_DSN`: Optional Sentry error tracking
- `DATABASE_URL`: Your database connection string
- All other existing environment variables work the same

## Monitoring Shards

### View Shard Status
```bash
# Watch logs while running
npm run dev:shards
```

Logs show:
```
[sharding] Shard created (shardId: 0)
[sharding] Shard ready (shardId: 0, guilds: 2500)
[sharding] Shard created (shardId: 1)
[sharding] Shard ready (shardId: 1, guilds: 2401)
...
[sharding] All shards spawned successfully (totalShards: 4)
```

### Per-Shard Memory
Each shard process runs independently with its own memory space:
```
Shard 0: ~150-250MB
Shard 1: ~150-250MB
Shard 2: ~150-250MB
Shard 3: ~150-250MB
Manager: ~50MB
Total: ~650MB-1050MB for 10k+ guilds
```

Without sharding (single process): ~600-800MB for same 10k+ guilds
*(Sharding overhead is minimal while adding major stability benefits)*

## How Sharding Works

### Architecture
```
┌─────────────────────────────┐
│   ShardingManager (shard.js)│  Main process, spawns/monitors shards
└────────────┬────────────────┘
             │
    ┌────────┴────────┬────────────┬──────────┐
    │                 │            │          │
┌───▼───┐        ┌───▼───┐   ┌───▼───┐  ┌──▼───┐
│Shard 0│        │Shard 1│   │Shard 2│  │Shard3│
│       │        │       │   │       │  │      │
│Discord│        │Discord│   │Discord│  │Discord
│Client │        │Client │   │Client │  │Client │
└───────┘        └───────┘   └───────┘  └──────┘
 Guilds 0-X   Guilds X+1-Y  Guilds Y+1-Z  ...
```

### Shard Assignment
Discord automatically assigns guilds to shards based on guild ID:
```
Shard ID = (Guild ID >> 22) % Total Shards
```

When a guild is created, Discord tells your bot which shard it belongs to automatically.

## Guild-Specific Shard Lookup

To find which shard a guild is on during interactions:

```javascript
const guildId = interaction.guild.id;
const shardIdForGuild = interaction.guild.shardId;  // Automatic
// Or manually:
// const shardId = (BigInt(guildId) >> 22n) % BigInt(interaction.client.shard.count);
```

The `/ping` command automatically shows the shard for the current guild.

## Database Considerations

All shards share the same database. Make sure your database can handle:

- **Concurrent connections**: Each shard may have its own connection
- **Connection pooling**: Configure `DB_POOL_MAX` appropriately
  - For sharding: `DB_POOL_MAX = 10 + (totalShards * 3)`
  - Example: 4 shards → `DB_POOL_MAX = 22`

Database queries are automatically batched and cached (see SCALABILITY.md).

## Troubleshooting

### "ECONNREFUSED" errors
- Database isn't running or not reachable from shard process
- Check `DATABASE_URL` environment variable
- Verify network connectivity between shard processes and database

### Shards not spawning
- Insufficient system resources (memory, file descriptors)
- Check `ulimit -n` on Unix systems (should be ~10000+)
- Increase if needed: `ulimit -n 10000`

### High memory usage
- Each shard caches guild data; this is normal
- Monitor with `top` or `ps aux`
- If excessive, check for memory leaks in event handlers

### Shard keeps crashing
- Check logs for the specific shard: `grep "Shard [0-9]" logs/*.log`
- Look for unhandled promise rejections or exceptions
- Enable Sentry for automatic error tracking

## Migration from Single Process

1. **Stop the single-process bot**: `npm run dev` or `npm start`
2. **Start sharded version**: `npm run dev:shards` or `npm run start:shards`
3. **Monitor initial startup**: Takes slightly longer as Discord validates shard count
4. **Check `/ping` command**: Should show `📍 Shard X/Y` now

## Graceful Shutdown

Both `SIGINT` (Ctrl+C) and `SIGTERM` signals are handled:
- All shards receive graceful shutdown
- Database connections close cleanly
- In-flight operations complete
- Process exits cleanly

## Performance Impact

### With Sharding
- **Startup time**: +2-5 seconds (Discord validation + shard spawning)
- **Memory per shard**: ~150-250MB (smaller than single process)
- **Command latency**: Slightly lower per guild (less contention)
- **Stability**: Significantly improved (shard isolation)

### Recommended for:
- 2000+ guilds
- 50,000+ monthly active users
- Production deployments
- High-availability requirements

### Not needed for:
- <500 guilds
- Development/testing
- Private bots for small communities

## Advanced: Custom Shard Count

For regional deployment or load balancing:

```javascript
// shard.js - Override auto-calculation
const targetGuildsPerShard = 10000;  // Discord recommends ~2500, we use 10000
const recommendedShards = manager.totalShards;
console.log(`Discord recommends ${recommendedShards} shards`);
```

## Further Reading

- [Discord.js Sharding Guide](https://discordjs.guide/sharding/)
- [Discord API Documentation](https://discord.com/developers/docs/topics/gateway#sharding)
- [SCALABILITY.md](./SCALABILITY.md) - Performance optimization guide
