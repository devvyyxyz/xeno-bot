const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const filePath = path.join(logsDir, 'fallback.log');

const pad = (n) => String(n).padStart(2, '0');
const shortTimestamp = () => {
  const d = new Date();
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

function write(level, msg, meta) {
  try {
    const metaStr = meta ? ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}` : '';
    const line = `${shortTimestamp()} [${level}] ${msg}${metaStr}\n`;
    fs.appendFileSync(filePath, line);
  } catch (e) {
    // best-effort only — swallow errors to avoid recursive failures
  }
}

module.exports = {
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  info: (msg, meta) => write('info', msg, meta)
};
