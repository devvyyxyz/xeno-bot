// Rate limiter using token bucket algorithm
// Prevents abuse and protects bot resources under high load

class RateLimiter {
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 5; // Max requests
    this.refillRate = options.refillRate || 1; // Tokens per interval
    this.refillInterval = options.refillInterval || 1000; // 1 second
    this.buckets = new Map(); // userId -> { tokens, lastRefill }
    this.penalties = new Map(); // userId -> penalty expiry timestamp
    
    // Start cleanup interval to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Every minute
  }

  // Check if user can perform action
  async checkLimit(userId, cost = 1) {
    const now = Date.now();
    
    // Check if user is penalized (temporary ban)
    const penalty = this.penalties.get(userId);
    if (penalty && now < penalty) {
      return {
        allowed: false,
        retryAfter: Math.ceil((penalty - now) / 1000),
        reason: 'rate_limit_exceeded'
      };
    } else if (penalty) {
      this.penalties.delete(userId);
    }
    
    // Get or create bucket
    let bucket = this.buckets.get(userId);
    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefill: now
      };
      this.buckets.set(userId, bucket);
    }
    
    // Refill tokens based on time elapsed
    const timeSinceRefill = now - bucket.lastRefill;
    const refills = Math.floor(timeSinceRefill / this.refillInterval);
    if (refills > 0) {
      bucket.tokens = Math.min(
        this.maxTokens,
        bucket.tokens + (refills * this.refillRate)
      );
      bucket.lastRefill = now;
    }
    
    // Check if user has enough tokens
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: bucket.tokens,
        resetIn: Math.ceil(this.refillInterval / 1000)
      };
    }
    
    // Not enough tokens
    return {
      allowed: false,
      retryAfter: Math.ceil((this.refillInterval - (now - bucket.lastRefill)) / 1000),
      reason: 'rate_limit'
    };
  }

  // Penalize user (temporary ban for abuse)
  penalize(userId, durationMs = 60000) {
    this.penalties.set(userId, Date.now() + durationMs);
  }

  // Reset user's rate limit
  reset(userId) {
    this.buckets.delete(userId);
    this.penalties.delete(userId);
  }

  // Get current status for user
  getStatus(userId) {
    const bucket = this.buckets.get(userId);
    if (!bucket) {
      return {
        tokens: this.maxTokens,
        maxTokens: this.maxTokens
      };
    }
    
    const now = Date.now();
    const timeSinceRefill = now - bucket.lastRefill;
    const refills = Math.floor(timeSinceRefill / this.refillInterval);
    const currentTokens = Math.min(
      this.maxTokens,
      bucket.tokens + (refills * this.refillRate)
    );
    
    return {
      tokens: currentTokens,
      maxTokens: this.maxTokens,
      penalized: this.penalties.has(userId)
    };
  }

  // Clean up old entries to prevent memory leaks
  cleanup() {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    
    // Remove old buckets
    for (const [userId, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > maxAge) {
        this.buckets.delete(userId);
      }
    }
    
    // Remove expired penalties
    for (const [userId, expiry] of this.penalties.entries()) {
      if (now > expiry) {
        this.penalties.delete(userId);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

// Global rate limiters for different command types
const rateLimiters = {
  // General commands: 10 commands per 10 seconds
  general: new RateLimiter({
    maxTokens: 10,
    refillRate: 1,
    refillInterval: 1000
  }),
  
  // Expensive operations (hunt, evolve): 3 per 10 seconds
  expensive: new RateLimiter({
    maxTokens: 3,
    refillRate: 1,
    refillInterval: 3000
  }),
  
  // Very expensive operations (shop purchases): 5 per 30 seconds
  transactions: new RateLimiter({
    maxTokens: 5,
    refillRate: 1,
    refillInterval: 6000
  }),
  
  // Admin commands: 20 per 10 seconds
  admin: new RateLimiter({
    maxTokens: 20,
    refillRate: 2,
    refillInterval: 1000
  })
};

// Helper function to check rate limit in commands
async function checkCommandRateLimit(interaction, type = 'general') {
  const limiter = rateLimiters[type] || rateLimiters.general;
  const result = await limiter.checkLimit(interaction.user.id);
  
  if (!result.allowed) {
    await interaction.reply({
      content: `⏱️ **Rate Limit Exceeded**\n\nYou're using commands too quickly. Please wait ${result.retryAfter} second(s) before trying again.`,
      ephemeral: true
    });
    return false;
  }
  
  return true;
}

module.exports = {
  RateLimiter,
  rateLimiters,
  checkCommandRateLimit
};

// Example usage in commands:
/*
const { checkCommandRateLimit } = require('../../utils/rateLimiter');

async executeInteraction(interaction) {
  // Check rate limit before processing
  if (!await checkCommandRateLimit(interaction, 'expensive')) {
    return; // Rate limit message already sent
  }
  
  // Process command...
}
*/
