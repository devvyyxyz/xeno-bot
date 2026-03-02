// Enhanced TTL cache with LRU eviction and size limits for high-scale operations
class EnhancedCache {
  constructor(options = {}) {
    this.map = new Map();
    this.maxSize = options.maxSize || 10000; // Limit cache size to prevent memory leaks
    this.defaultTTL = options.defaultTTL || 300000; // 5 minutes default
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0
    };
  }

  set(key, value, ttlMs) {
    // Enforce size limit with LRU eviction
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
      // Evict oldest entry (first entry in Map maintains insertion order)
      const firstKey = this.map.keys().next().value;
      this.del(firstKey);
      this.stats.evictions++;
    }

    const ttl = ttlMs || this.defaultTTL;
    const expires = ttl ? Date.now() + ttl : null;
    
    if (this.map.has(key)) {
      const existing = this.map.get(key);
      clearTimeout(existing.timeout);
    }
    
    const timeout = ttl ? setTimeout(() => this.map.delete(key), ttl) : null;
    
    // Move to end of Map for LRU (delete + re-add)
    this.map.delete(key);
    this.map.set(key, { value, expires, timeout });
    this.stats.sets++;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    if (entry.expires && Date.now() > entry.expires) {
      this.map.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Move to end for LRU (touch)
    this.map.delete(key);
    this.map.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  // Get or compute - prevents cache stampede for expensive operations
  async getOrCompute(key, computeFn, ttlMs) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }
    
    // Check if already computing this key to prevent duplicate work
    const computingKey = `__computing_${key}`;
    const computing = this.map.get(computingKey);
    if (computing) {
      // Wait for the ongoing computation
      return computing.value;
    }
    
    // Mark as computing
    const computePromise = (async () => {
      try {
        const result = await computeFn();
        this.set(key, result, ttlMs);
        return result;
      } finally {
        // Remove computing marker
        this.map.delete(computingKey);
      }
    })();
    
    // Store the promise temporarily
    this.map.set(computingKey, { value: computePromise, expires: null, timeout: null });
    
    return computePromise;
  }

  has(key) {
    return this.get(key) !== null;
  }

  del(key) {
    const entry = this.map.get(key);
    if (entry) {
      clearTimeout(entry.timeout);
      this.map.delete(key);
      return true;
    }
    return false;
  }

  // Delete all keys matching a pattern (useful for invalidation)
  delPattern(pattern) {
    let deleted = 0;
    const regex = new RegExp(pattern);
    for (const key of this.map.keys()) {
      if (regex.test(key)) {
        this.del(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear() {
    for (const [k, v] of this.map.entries()) {
      clearTimeout(v.timeout);
    }
    this.map.clear();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  size() {
    return this.map.size;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.map.size,
      maxSize: this.maxSize
    };
  }

  // Periodic cleanup of expired entries (call this on an interval)
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.map.entries()) {
      if (entry.expires && now > entry.expires) {
        this.del(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Export singleton with reasonable defaults for bot use
module.exports = new EnhancedCache({
  maxSize: 10000,  // Cache up to 10k items
  defaultTTL: 300000  // 5 minute default TTL
});

// Also export the class for custom instances
module.exports.EnhancedCache = EnhancedCache;
