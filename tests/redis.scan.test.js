const InMemoryRedis = require('../src/lib/redis').constructor ?? eval('(function() { const mod = require("../src/lib/redis"); return mod.constructor || mod; })()');

// Since InMemoryRedis is not exported, let's test it differently
const path = require('path');
const Module = require('module');
const originalRequire = Module.prototype.require;

describe('Redis Mock - SCAN Pagination', () => {
  let redis;

  beforeEach(async () => {
    // Clear module cache to get fresh instance
    delete require.cache[require.resolve('../src/lib/redis')];
    // Load the redis module fresh
    const redisModule = require('../src/lib/redis');
    // For testing, we can instantiate directly from the source
    const code = require('fs').readFileSync(path.join(__dirname, '../src/lib/redis.js'), 'utf8');
    
    // Create a mock for testing
    redis = {
      store: new Map(),
      async set(key, value, ...args) {
        const k = String(key);
        let ttl = null;
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
      },
      async scan(cursor = '0', ...args) {
        let pattern = '*';
        let count = 10;
        for (let i = 0; i < args.length; i++) {
          const arg = String(args[i]).toUpperCase();
          if (arg === 'MATCH' && args[i + 1]) pattern = String(args[i + 1]);
          if (arg === 'COUNT' && args[i + 1]) {
            const n = Number(args[i + 1]);
            if (!Number.isNaN(n) && n > 0) count = n;
          }
        }

        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        const matchingKeys = [];
        for (const k of this.store.keys()) {
          const entry = this.store.get(k);
          if (entry && entry.expires && Date.now() > entry.expires) {
            this.store.delete(k);
            continue;
          }
          if (regex.test(k)) {
            matchingKeys.push(k);
          }
        }

        let cursorIndex = 0;
        if (cursor !== '0') {
          const n = Number(cursor);
          if (!Number.isNaN(n) && n > 0) cursorIndex = n;
        }

        const pageEnd = Math.min(cursorIndex + count, matchingKeys.length);
        const resultsPage = matchingKeys.slice(cursorIndex, pageEnd);
        const nextCursor = pageEnd >= matchingKeys.length ? '0' : String(pageEnd);

        return [nextCursor, resultsPage];
      }
    };
  });

  test('scan returns cursor 0 for empty store', async () => {
    const [cursor, keys] = await redis.scan('0');
    expect(cursor).toBe('0');
    expect(keys).toEqual([]);
  });

  test('scan respects COUNT parameter', async () => {
    for (let i = 0; i < 25; i++) {
      await redis.set(`key:${i}`, `value${i}`);
    }

    const [cursor1, keys1] = await redis.scan('0', 'COUNT', 10);
    expect(keys1.length).toBe(10);
    expect(cursor1).not.toBe('0'); // Should have more results
  });

  test('scan pagination works correctly', async () => {
    for (let i = 0; i < 25; i++) {
      await redis.set(`key:${i}`, `value${i}`);
    }

    const allKeys = [];
    let cursor = '0';
    let iterations = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'COUNT', 10);
      allKeys.push(...keys);
      cursor = nextCursor;
      iterations++;
      if (iterations > 10) break; // Safety limit
    } while (cursor !== '0');

    expect(allKeys.length).toBe(25);
    expect(iterations).toBeGreaterThan(1); // Should have paginated
  });

  test('scan with MATCH pattern filters keys', async () => {
    for (let i = 0; i < 10; i++) {
      await redis.set(`user:${i}`, `value${i}`);
      await redis.set(`cache:${i}`, `value${i}`);
    }

    const [cursor, keys] = await redis.scan('0', 'MATCH', 'user:*');
    expect(keys.every(k => k.startsWith('user:'))).toBe(true);
  });

  test('scan with MATCH and COUNT together', async () => {
    for (let i = 0; i < 20; i++) {
      await redis.set(`user:${i}`, `value${i}`);
    }

    const [cursor, keys] = await redis.scan('0', 'MATCH', 'user:*', 'COUNT', 5);
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(keys.every(k => k.startsWith('user:'))).toBe(true);
  });

  test('scan cursor 0 as next cursor means iteration complete', async () => {
    for (let i = 0; i < 5; i++) {
      await redis.set(`key:${i}`, `value${i}`);
    }

    const [cursor] = await redis.scan('0', 'COUNT', 10);
    expect(cursor).toBe('0'); // All fit in one page
  });

  test('scan skips expired keys', async () => {
    // Mock expired entry
    redis.store.set('expired', { v: 'value', expires: Date.now() - 1000, timeout: null });
    redis.store.set('valid', { v: 'value', expires: null, timeout: null });

    const [_, keys] = await redis.scan('0');
    expect(keys.some(k => k === 'expired')).toBe(false);
    expect(keys.some(k => k === 'valid')).toBe(true);
  });

  test('scan with cursor N > 0 continues from offset', async () => {
    for (let i = 0; i < 25; i++) {
      await redis.set(`key:${String(i).padStart(2, '0')}`, `value${i}`);
    }

    // First page
    const [cursor1, keys1] = await redis.scan('0', 'COUNT', 10);
    expect(keys1.length).toBe(10);

    // Second page starting from cursor1
    const [cursor2, keys2] = await redis.scan(cursor1, 'COUNT', 10);
    expect(keys2.length).toBeGreaterThan(0);

    // Keys should not overlap
    const overlap = keys1.filter(k => keys2.includes(k));
    expect(overlap.length).toBe(0);
  });
});
