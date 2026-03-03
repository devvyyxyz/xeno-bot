const logger = require('./logger').get('utils:jsonParse');

/**
 * Safely parse a JSON string with error handling
 * @param {string|object|null} value - The value to parse
 * @param {object|null} defaultValue - Default value if parsing fails (default: {})
 * @param {string} fieldName - Field name for logging purposes
 * @returns {object|null} Parsed object or default value
 */
function parseJSON(value, defaultValue = {}, fieldName = 'field') {
  // If already an object, return it (avoid double-parsing)
  if (value && typeof value === 'object') {
    return value;
  }

  // If null or falsy, return default
  if (!value) {
    return defaultValue;
  }

  // Try to parse the string
  try {
    return JSON.parse(value);
  } catch (err) {
    logger.warn(`Failed parsing ${fieldName} JSON`, { error: err?.message, value: typeof value });
    return defaultValue;
  }
}

module.exports = { parseJSON };
