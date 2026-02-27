const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../../logs/error.log');

try {
  fs.writeFileSync(logPath, '');
  // eslint-disable-next-line no-console
  console.log('Cleared error.log');
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('Failed to clear error.log:', err);
}
