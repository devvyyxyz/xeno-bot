/**
 * Collection of safe utility functions to reduce nested try-catch blocks
 * and provide consistent error handling patterns throughout the codebase.
 */

/**
 * Safely parse JSON with a fallback default value.
 * Eliminates the need for inline try-catch blocks for JSON parsing.
 *
 * @param {string} value - The string to parse
 * @param {*} defaultValue - The value to return if parsing fails
 * @param {object} logger - Optional logger instance for error reporting
 * @returns {*} The parsed object or defaultValue
 */
function safeJsonParse(value, defaultValue = {}, logger = null) {
  try {
    if (value === null || value === undefined) return defaultValue;
    return JSON.parse(value);
  } catch (err) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('Failed parsing JSON', {
        value: typeof value === 'string' ? value.slice(0, 100) : String(value),
        error: err && (err.message || err),
      });
    }
    return defaultValue;
  }
}

/**
 * Safely log process memory usage with consistent formatting.
 * Prevents memory logging from crashing the process or being spammed.
 *
 * @param {object} logger - Logger instance
 * @param {string} label - Label for the log entry
 * @param {object} extras - Additional fields to include in the log
 * @returns {object|null} Memory object {heapUsedMb, rssMb} or null if failed
 */
function safeLogMemory(logger, label, extras = {}) {
  try {
    if (!logger || typeof logger.info !== 'function') return null;
    const mu = process.memoryUsage();
    const memData = {
      heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 10) / 10,
      rssMb: Math.round((mu.rss / 1024 / 1024) * 10) / 10,
      ...extras,
    };
    logger.info(label, memData);
    return memData;
  } catch (err) {
    // Silently fail - don't let memory logging break things
    return null;
  }
}

/**
 * Safely await a promise with optional error logging.
 * Provides consistent error handling without exposing implementation details.
 *
 * @param {Promise} promise - The promise to await
 * @param {object} logger - Logger instance for error reporting
 * @param {string} errorLabel - Label for error context
 * @param {boolean} shouldThrow - If true, rethrow the error; if false, return null
 * @returns {*} The promise result or null/error depending on shouldThrow
 */
async function safeAwait(promise, logger, errorLabel, shouldThrow = false) {
  try {
    return await promise;
  } catch (err) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(errorLabel, {
        error: err && (err.stack || err.message || err),
      });
    }
    if (shouldThrow) throw err;
    return null;
  }
}

/**
 * Create a safe error object for logging that extracts stack trace or message.
 *
 * @param {Error|string} error - The error to process
 * @returns {*} Object with stack or message properties
 */
function extractErrorInfo(error) {
  if (!error) return null;
  if (error.stack) return error.stack;
  if (error.message) return error.message;
  return error;
}

/**
 * Safely execute a synchronous function and return a default value on error.
 *
 * @param {Function} fn - The function to execute
 * @param {*} defaultValue - The value to return on error
 * @param {object} logger - Optional logger for error reporting
 * @param {string} label - Optional label for the operation
 * @returns {*} The function result or defaultValue
 */
function safeExecute(fn, defaultValue = null, logger = null, label = 'Safe execution') {
  try {
    return fn();
  } catch (err) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(label, { error: extractErrorInfo(err) });
    }
    return defaultValue;
  }
}

module.exports = {
  safeJsonParse,
  safeLogMemory,
  safeAwait,
  extractErrorInfo,
  safeExecute,
};
