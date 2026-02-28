const fs = require('fs');
const path = require('path');
const logger = require('./logger').get('clearErrorLog');

const logPath = path.join(__dirname, '../../logs/error.log');

try {
  fs.writeFileSync(logPath, '');
  logger.info('Cleared error.log');
} catch (err) {
  logger.error('Failed to clear error.log', { error: err && (err.stack || err) });
}
