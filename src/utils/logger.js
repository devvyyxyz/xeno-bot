const { createLogger, format, transports, addColors } = require('winston');
const { combine, timestamp, printf, colorize, errors, splat } = format;
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const levelColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'gray'
};
addColors(levelColors);

const fileFormat = printf(({ timestamp, level, message, label, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const msg = stack || message;
  return `${timestamp} [${level}]${label ? ` [${label}]` : ''} ${msg}${metaStr}`;
});

const consoleFormat = printf(({ timestamp, level, message, label, stack }) => {
  const msg = stack || message;
  return `${timestamp} [${level}]${label ? ` [${label}]` : ''} ${msg}`;
});

// Short UTC timestamp helper: "MM-DD HH:mm" (year removed)
const shortTimestamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(errors({ stack: true }), splat(), timestamp({ format: shortTimestamp })),
  transports: [
    // Rotating application log
    new DailyRotateFile({
      filename: path.join(logsDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: combine(timestamp({ format: shortTimestamp }), fileFormat)
    }),
    // Keep a separate error file for quick access
    new transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error', format: combine(timestamp({ format: shortTimestamp }), fileFormat) })
  ],
  exitOnError: false
});

// Console with colors and stack printing in non-production
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({ format: combine(colorize({ all: true }), timestamp({ format: shortTimestamp }), consoleFormat) }));
} else {
  // In production still log to console (no colors)
  logger.add(new transports.Console({ format: combine(timestamp({ format: shortTimestamp }), fileFormat) }));
}

// Optional Papertrail remote logging
// Optional generic HTTP remote logging using Winston's Http transport
if (process.env.LOG_REMOTE_URL) {
  try {
    const { URL } = require('url');
    const remote = new URL(process.env.LOG_REMOTE_URL);
    const httpOpts = {
      host: remote.hostname,
      path: remote.pathname + (remote.search || ''),
      port: remote.port ? Number(remote.port) : (remote.protocol === 'https:' ? 443 : 80),
      ssl: remote.protocol === 'https:',
      level: process.env.LOG_REMOTE_LEVEL || 'info'
    };
    if (remote.username || remote.password) httpOpts.auth = `${remote.username}:${remote.password}`;
    const HttpTransport = transports.Http;
    const ht = new HttpTransport(httpOpts);
    ht.on('error', (err) => logger.error('Remote HTTP transport error', { error: String(err) }));
    logger.add(ht);
    logger.info('Remote HTTP transport initialized', { url: process.env.LOG_REMOTE_URL });
  } catch (err) {
    logger.error('Failed to initialize remote HTTP transport', { error: err.stack || err });
  }
}

// Helper to get a namespaced child logger
logger.get = (label) => logger.child({ label });

module.exports = logger;
