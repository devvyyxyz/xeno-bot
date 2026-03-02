// Simple in-memory TTL cache
class TTLCache {
  constructor() {
    this.map = new Map();
    this._sweeper = null;
    this._startSweeper();
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

  sweep() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.map.entries()) {
      if (entry && entry.expires && now > entry.expires) {
        clearTimeout(entry.timeout);
        this.map.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  _startSweeper() {
    const enabled = process.env.CACHE_SWEEP_ENABLED !== 'false';
    if (!enabled) return;
    const intervalMs = Number(process.env.CACHE_SWEEP_INTERVAL_MS) || 60000;
    this._sweeper = setInterval(() => {
      try {
        this.sweep();
      } catch (_) {}
    }, intervalMs);
    if (this._sweeper && typeof this._sweeper.unref === 'function') this._sweeper.unref();
  }
}

module.exports = new TTLCache();
