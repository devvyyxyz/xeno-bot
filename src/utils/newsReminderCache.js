/**
 * News reminder cache - reduces DB lookups for article reminder checks
 * Stores user's latest read article timestamp with TTL
 * 
 * Cache hits avoid unnecessary DB queries during high-interaction periods
 */

const logger = require('./logger').get('utils:newsReminderCache');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class NewsReminderCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get cached reminder data for a user
   * @param {string} userId - Discord user ID
   * @returns {object|null} Cached data with latest timestamp, or null if expired/missing
   */
  get(userId) {
    const cached = this.cache.get(userId);
    if (!cached) return null;

    // Check if expired
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(userId);
      return null;
    }

    return { latestTimestamp: cached.latestTimestamp };
  }

  /**
   * Set cache entry for a user
   * @param {string} userId - Discord user ID
   * @param {number} latestTimestamp - User's last read article timestamp
   */
  set(userId, latestTimestamp) {
    this.cache.set(userId, {
      latestTimestamp,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
  }

  /**
   * Invalidate cache entry (call after user reads article)
   * @param {string} userId - Discord user ID
   */
  invalidate(userId) {
    this.cache.delete(userId);
  }

  /**
   * Clear all expired entries (cleanup)
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [userId, data] of this.cache) {
      if (now > data.expiresAt) {
        this.cache.delete(userId);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired entries from news reminder cache`);
    }
  }

  /**
   * Get cache stats (for monitoring)
   */
  getStats() {
    return {
      size: this.cache.size,
      ttlMs: CACHE_TTL_MS
    };
  }
}

const cache = new NewsReminderCache();

// Cleanup every 10 minutes
const _newsReminderSweep = setInterval(() => cache.cleanup(), 10 * 60 * 1000);
if (_newsReminderSweep && typeof _newsReminderSweep.unref === 'function') _newsReminderSweep.unref();

module.exports = cache;
