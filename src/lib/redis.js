const { spawnSync } = require('child_process');
const path = require('path');

// Lightweight in-memory Redis-like shim used when Redis not configured/available.
class InMemoryRedis {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    const entry = this.store.get(String(key));
    if (!entry) return null;
    if (entry.expires && Date.now() > entry.expires) {
      this.store.delete(String(key));
      return null;
    }
    return entry.v;
  }

  async set(key, value, ...args) {
    const k = String(key);
    let ttl = null;
    // Support: set(key, value) or set(key, value, 'PX', ttlMs)
    if (args && args.length >= 2 && String(args[0]).toUpperCase() === 'PX') {
      const n = Number(args[1]);
      if (!Number.isNaN(n) && n > 0) ttl = Date.now() + n;
    }
    if (this.store.has(k)) {
      const prev = this.store.get(k);
      if (prev.timeout) clearTimeout(prev.timeout);
    }
    const obj = { v: String(value), expires: ttl || null, timeout: null };
    if (ttl) {
      const ms = ttl - Date.now();
      obj.timeout = setTimeout(() => this.store.delete(k), ms);
    }
    this.store.set(k, obj);
    return 'OK';
  }

  async del(...keys) {
    let deleted = 0;
    for (const k of keys) {
      const s = String(k);
      if (this.store.has(s)) {
        const e = this.store.get(s);
        if (e && e.timeout) clearTimeout(e.timeout);
        this.store.delete(s);
        deleted++;
      }
    }
    return deleted;
  }

  // SCAN implementation with proper cursor-based pagination
  // Supports MATCH pattern and COUNT hints, behaves like real Redis SCAN
  async scan(cursor = '0', ...args) {
    // Parse arguments: MATCH pattern COUNT count
    let pattern = '*';
    let count = 10; // default page size
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'MATCH' && args[i + 1]) pattern = String(args[i + 1]);
      if (arg === 'COUNT' && args[i + 1]) {
        const n = Number(args[i + 1]);
        if (!Number.isNaN(n) && n > 0) count = n;
      }
    }

    // Compile pattern regex (basic glob: * → .*)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');

    // Get all matching keys, skipping expired entries
    const matchingKeys = [];
    for (const k of this.store.keys()) {
      const entry = this.store.get(k);
      // Clean up expired entries
      if (entry && entry.expires && Date.now() > entry.expires) {
        this.store.delete(k);
        continue;
      }
      // Check pattern match
      if (regex.test(k)) {
        matchingKeys.push(k);
      }
    }

    // Parse cursor as starting index
    let cursorIndex = 0;
    if (cursor !== '0') {
      const n = Number(cursor);
      if (!Number.isNaN(n) && n > 0) cursorIndex = n;
    }

    // Extract page of results starting from cursor index
    const pageEnd = Math.min(cursorIndex + count, matchingKeys.length);
    const resultsPage = matchingKeys.slice(cursorIndex, pageEnd);

    // Calculate next cursor
    // '0' means we've reached the end, otherwise it's the next starting index
    const nextCursor = pageEnd >= matchingKeys.length ? '0' : String(pageEnd);

    return [nextCursor, resultsPage];
  }

  // No-op event methods for compatibility
  on() { return this; }
  once() { return this; }
  quit() { return Promise.resolve(); }
  disconnect() { /* no-op */ }
}

let client = null;

// Decide whether to use a real Redis client: prefer real when connection env is present
const redisConfigured = !!(process.env.REDIS_URL || process.env.REDIS_HOST || process.env.AUTO_START_REDIS === '1');
let IORedis = null;
if (redisConfigured) {
  try {
    IORedis = require('ioredis');
  } catch (e) {
    IORedis = null;
  }
}

if (IORedis) {
  const redisOptions = process.env.REDIS_URL ? process.env.REDIS_URL : {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  };

  if (process.env.AUTO_START_REDIS === '1') {
    try {
      const helper = path.join(__dirname, '..', 'bin', 'ensure-redis.js');
      const res = spawnSync(process.execPath, [helper], { stdio: 'ignore', timeout: Number(process.env.AUTO_START_REDIS_TIMEOUT_MS) || 20_000 });
      if (res && typeof res.status === 'number' && res.status !== 0) {
        const redisRequired = String(process.env.REDIS_REQUIRED || '').toLowerCase();
        if (redisRequired === '1' || redisRequired === 'true' || redisRequired === 'yes') {
          console.error('[redis] AUTO_START_REDIS requested and helper failed; Redis required by REDIS_REQUIRED, exiting');
          process.exit(1);
        }
        console.warn('[redis] AUTO_START_REDIS requested but helper failed to start Redis; continuing without Redis');
      }
    } catch (e) {
      console.error('[redis] Failed running AUTO_START_REDIS helper', e && (e.stack || e));
      const redisRequired = String(process.env.REDIS_REQUIRED || '').toLowerCase();
      if (redisRequired === '1' || redisRequired === 'true' || redisRequired === 'yes') process.exit(1);
    }
  }

  try {
    client = new IORedis(redisOptions);
    client.on('error', (err) => { console.error('[redis] error', err && err.message ? err.message : err); });
    client.on('connect', () => { console.info('[redis] connected'); });
  } catch (e) {
    console.warn('[redis] failed to create ioredis client, falling back to in-memory stub', e && (e.stack || e));
    client = new InMemoryRedis();
  }
} else {
  // No real Redis configured/available — use in-memory stub
  console.info('[redis] no Redis configured; using in-memory stub');
  console.info('[redis] To enable real Redis locally: install Redis (Homebrew: "brew install redis"), then either run "brew services start redis" or set AUTO_START_REDIS=1 to let the helper try to spawn redis-server. Alternatively set REDIS_HOST/REDIS_URL to a reachable Redis instance.');
  client = new InMemoryRedis();
}

module.exports = client;
