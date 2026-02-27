// Simple in-memory TTL cache
class TTLCache {
  constructor() {
    this.map = new Map();
  }

  set(key, value, ttlMs) {
    const expires = ttlMs ? Date.now() + ttlMs : null;
    if (this.map.has(key)) {
      clearTimeout(this.map.get(key).timeout);
    }
    const timeout = ttlMs ? setTimeout(() => this.map.delete(key), ttlMs) : null;
    this.map.set(key, { value, expires, timeout });
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expires && Date.now() > entry.expires) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  del(key) {
    const entry = this.map.get(key);
    if (entry) {
      clearTimeout(entry.timeout);
      this.map.delete(key);
    }
  }

  clear() {
    for (const [k, v] of this.map.entries()) {
      clearTimeout(v.timeout);
    }
    this.map.clear();
  }
}

module.exports = new TTLCache();
