/**
 * Configuration for background workers
 * Centralized location for magic numbers and strings
 */

module.exports = {
  // Hive Worker Configuration
  hive: {
    // Chunk processing
    chunkSize: Number(process.env.HIVE_WORKER_CHUNK_SIZE) || 200,
    chunkDelayMs: Number(process.env.HIVE_WORKER_CHUNK_DELAY_MS) || 20,

    // Production calculation
    msPerHour: 3600000,

    // Poll interval for hive processing (default: 60 seconds)
    pollMs: Number(process.env.HIVE_WORKER_POLL_MS) || 60 * 1000,
  },

  // Evolution Worker Configuration
  evolution: {
    // Maximum jobs to process per run (prevents overwhelming the system)
    maxJobsPerRun: Number(process.env.EVOLUTION_MAX_JOBS_PER_RUN) || 20,

    // Poll interval for job processing (default: 30 seconds)
    pollMs: Number(process.env.EVOLUTION_WORKER_POLL_MS) || 30 * 1000,

    // Default role display when role/stage is unknown
    defaultRoleDisplay: 'unknown',
  },

  // Shared Configuration
  memory: {
    // Enable memory diagnostics via environment variable
    diagnosticsEnabled: process.env.ENABLE_MEMORY_DIAGNOSTICS === '1',
  },

  // Redis Configuration
  redis: {
    // Default page size for SCAN operations
    scanDefaultCount: 10,
  },

  // Database Configuration
  database: {
    // Transaction timeout (ms)
    transactionTimeoutMs: 30000,
  },
};
