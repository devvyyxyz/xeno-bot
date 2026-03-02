# Scalability Optimizations for Xeno-Bot

This document outlines optimizations implemented to handle large user loads efficiently.

## 📊 Changes Made

### 1. **Database Connection Pooling** ✅
**File:** `src/db/index.js`

**Changes:**
- Increased max connections from 7 to 20 (configurable via `DB_POOL_MAX` env var)
- Set min connections to 2 (reduces connection latency)
- Added connection timeouts and idle management
- Added `propagateCreateError: false` to prevent crashes on pool errors

**Configuration:**
```env
DB_POOL_MAX=20  # Increase for higher concurrency (recommended: 20-50 for production)
```

### 2. **Database Indexes** ✅
**File:** `migrations/20260302110000_add_performance_indexes.js`

**Indexes Added:**
- `users`: Index on `created_at` for leaderboards
- `guild_settings`: Index on `enabled` for active guild queries
- `hives`: Indexes on `guild_id` and `queen_xeno_id`
- `xenomorphs`: Composite indexes on `(owner_id, stage)` and `(owner_id, role)`
- `hosts`: Indexes on `(owner_id, host_type)` and `rarity`
- `active_spawns`: Indexes on `guild_id`, `(channel_id, message_id)`, and `spawned_at`
- `evolution_queue`: Indexes on `(user_id, status)` and `(status, finishes_at)`
- `user_resources`: Index on `user_id`

**To Apply:**
```bash
npx knex migrate:latest
# Or for remote DB:
DATABASE_URL="your-connection-string" npx knex migrate:latest
```

### 3. **Enhanced Caching** ✅
**File:** `src/utils/enhancedCache.js`

**Features:**
- LRU (Least Recently Used) eviction policy
- Configurable size limit (default: 10,000 items)
- Cache statistics (hit rate, evictions)
- `getOrCompute()` method to prevent cache stampede
- Pattern-based invalidation
- Automatic cleanup of expired entries

**Usage:**
```javascript
const cache = require('./utils/enhancedCache');

// Simple caching
cache.set('user:123', userData, 60000); // Cache for 1 minute
const user = cache.get('user:123');

// Prevent cache stampede
const user = await cache.getOrCompute('user:123', async () => {
  return await fetchUserFromDB('123');
}, 60000);

// Get cache statistics
console.log(cache.getStats());
// { hits: 1500, misses: 200, hitRate: '88.24%', size: 1200, maxSize: 10000 }
```

### 4. **Query Batching** ✅
**File:** `src/utils/batchLoader.js`

**Features:**
- DataLoader-style batching
- Reduces N+1 query problems
- Configurable batch size and delay
- Built-in caching

**Usage:**
```javascript
const BatchLoader = require('./utils/batchLoader');
const db = require('../db');

// Create loader for users
const userLoader = new BatchLoader(async (discordIds) => {
  const rows = await db.knex('users')
    .whereIn('discord_id', discordIds)
    .select('*');
  
  const map = {};
  rows.forEach(row => { map[row.discord_id] = row; });
  return map;
}, { maxBatchSize: 100, batchDelayMs: 10 });

// Use in your code
const user = await userLoader.load('123456789');

// Multiple calls are batched automatically:
const [u1, u2, u3] = await Promise.all([
  userLoader.load('id1'),
  userLoader.load('id2'),
  userLoader.load('id3')
]);
// ^ Single query: SELECT * FROM users WHERE discord_id IN ('id1', 'id2', 'id3')
```

### 5. **Rate Limiting** ✅
**File:** `src/utils/rateLimiter.js`

**Features:**
- Token bucket algorithm
- Per-user rate limiting
- Different limits for command types
- Temporary penalties for abuse
- Automatic cleanup to prevent memory leaks

**Usage:**
```javascript
const { checkCommandRateLimit } = require('../../utils/rateLimiter');

async executeInteraction(interaction) {
  // Check rate limit (returns false if limited)
  if (!await checkCommandRateLimit(interaction, 'expensive')) {
    return; // User already notified
  }
  
  // Process command...
}
```

**Rate Limit Types:**
- `general`: 10 commands per 10 seconds
- `expensive`: 3 commands per 10 seconds (hunt, evolve)
- `transactions`: 5 commands per 30 seconds (shop)
- `admin`: 20 commands per 10 seconds

## 🚀 Implementation Recommendations

### High Priority (Implement Now)

#### 1. Apply Database Indexes
```bash
# Run the migration
DATABASE_URL="your-mysql-url" npx knex migrate:latest
```

#### 2. Add Caching to Frequently Accessed Data
```javascript
// In src/models/user.js
const enhancedCache = require('../utils/enhancedCache');

async function getUserByDiscordId(discordId) {
  const cacheKey = `user:${discordId}`;
  
  return await enhancedCache.getOrCompute(cacheKey, async () => {
    const row = await db.knex('users').where({ discord_id: discordId }).first();
    return row;
  }, 60000); // Cache for 1 minute
}
```

#### 3. Add Rate Limiting to Commands
```javascript
// In high-traffic commands like hunt, evolve, shop
const { checkCommandRateLimit } = require('../../utils/rateLimiter');

async executeInteraction(interaction) {
  if (!await checkCommandRateLimit(interaction, 'expensive')) return;
  // ... rest of command
}
```

### Medium Priority (Implement Soon)

#### 4. Use Batch Loaders in Leaderboards
```javascript
// When displaying leaderboards with multiple users
const BatchLoader = require('../utils/batchLoader');

const userLoader = new BatchLoader(async (ids) => {
  const users = await db.knex('users').whereIn('discord_id', ids).select('*');
  const map = {};
  users.forEach(u => { map[u.discord_id] = u; });
  return map;
});

// Fetch all users in parallel (batched into single query)
const users = await userLoader.loadMany(userIds);
```

#### 5. Optimize JSON Column Queries
```javascript
// BAD: This causes full table scan
const users = await knex('users').whereRaw("json_extract(data, '$.level') > 10");

// GOOD: Use a computed/indexed column or separate table
// Add a migration to extract frequently queried JSON fields to regular columns
```

#### 6. Add Request ID Tracking for Debugging
```javascript
// In src/events/interactionCreate.js
const { v4: uuidv4 } = require('uuid');

client.on('interactionCreate', async (interaction) => {
  const requestId = uuidv4();
  logger.info('Interaction received', { 
    requestId, 
    user: interaction.user.id, 
    command: interaction.commandName 
  });
  
  try {
    // ... handle interaction
  } catch (error) {
    logger.error('Interaction failed', { requestId, error });
  }
});
```

### Low Priority (Nice to Have)

#### 7. Implement Read Replicas (If Using PostgreSQL/MySQL)
```javascript
// In knexfile.js
module.exports = {
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 20 },
    // Use read replicas for heavy SELECT queries
    replicas: process.env.READ_REPLICA_URLS ? 
      process.env.READ_REPLICA_URLS.split(',').map(url => ({ connection: url })) : []
  }
};
```

#### 8. Add Monitoring and Alerting
```javascript
// Create src/utils/monitoring.js
const logger = require('./logger').get('monitoring');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      commands: new Map(), // command -> { count, totalTime, errors }
      queries: new Map(),  // query -> { count, totalTime }
    };
    
    // Log metrics every 5 minutes
    setInterval(() => this.logMetrics(), 300000);
  }
  
  trackCommand(name, duration, error = null) {
    const stats = this.metrics.commands.get(name) || { count: 0, totalTime: 0, errors: 0 };
    stats.count++;
    stats.totalTime += duration;
    if (error) stats.errors++;
    this.metrics.commands.set(name, stats);
  }
  
  logMetrics() {
    logger.info('Performance metrics', {
      commands: Array.from(this.metrics.commands.entries()).map(([name, stats]) => ({
        name,
        count: stats.count,
        avgTime: (stats.totalTime / stats.count).toFixed(2),
        errorRate: ((stats.errors / stats.count) * 100).toFixed(2)
      }))
    });
  }
}

module.exports = new PerformanceMonitor();
```

#### 9. Implement Graceful Shutdown
```javascript
// In src/index.js
const gracefulShutdown = async () => {
  logger.info('Received shutdown signal, closing connections...');
  
  // Stop accepting new connections
  if (client) {
    await client.destroy();
  }
  
  // Close database connections
  if (db.knex) {
    await db.knex.destroy();
  }
  
  logger.info('Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

## 📈 Expected Performance Improvements

With these optimizations:

1. **Database Queries**: 50-80% faster with proper indexes
2. **Cache Hit Rate**: 70-90% for frequently accessed data
3. **User Capacity**: Handle 10-100x more concurrent users
4. **Memory Usage**: Stable with LRU cache eviction
5. **API Response Time**: 200-500ms reduction on cached endpoints
6. **Rate Limit Protection**: Prevents abuse and API overload

## 🛠️ Recommended Environment Variables

Add these to your `.env` file:

```env
# Database
DB_POOL_MAX=20              # Max database connections (increase for high load)
DB_POOL_MIN=2               # Minimum idle connections

# Caching
CACHE_MAX_SIZE=10000        # Maximum items in cache
CACHE_DEFAULT_TTL=300000    # Default cache TTL (5 minutes)

# Rate Limiting
RATE_LIMIT_ENABLED=true     # Enable rate limiting
RATE_LIMIT_GENERAL=10       # General commands per 10s
RATE_LIMIT_EXPENSIVE=3      # Expensive commands per 10s
RATE_LIMIT_TRANSACTIONS=5   # Transaction commands per 30s

# Monitoring
LOG_PERFORMANCE=true        # Enable performance logging
METRICS_INTERVAL=300000     # Log metrics every 5 minutes
```

## 🔍 Monitoring Checklist

After deploying optimizations, monitor:

1. **Database Connection Pool**: Should stay below max
2. **Cache Hit Rate**: Should be >70% after warmup
3. **Response Times**: Should decrease for cached endpoints
4. **Memory Usage**: Should stabilize (no continuous growth)
5. **Error Rates**: Should remain low (<1%)
6. **Rate Limit Hits**: Track how often users hit limits

## 📚 Additional Resources

- [Knex.js Pooling Docs](http://knexjs.org/guide/#pooling)
- [Database Indexing Best Practices](https://use-the-index-luke.com/)
- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Discord.js Guide: Sharding](https://discordjs.guide/sharding/) (for >2,500 servers)

## 🚨 When to Shard

If your bot reaches **2,000+ servers**, implement sharding:

```javascript
// src/index.js
const { ShardingManager } = require('discord.js');

const manager = new ShardingManager('./src/bot.js', {
  token: process.env.TOKEN,
  totalShards: 'auto'
});

manager.on('shardCreate', shard => {
  logger.info(`Launched shard ${shard.id}`);
});

manager.spawn();
```

---

**Questions?** Check the implementation examples in each utility file or reference the Discord.js documentation.
