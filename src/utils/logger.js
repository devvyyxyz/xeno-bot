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

// If the host strips or disables TTY colors (some VPS/web consoles),
// allow forcing ANSI color codes via env `LOG_FORCE_COLOR=1` or `FORCE_COLOR=1`.
const forceColor = process.env.LOG_FORCE_COLOR === '1' || process.env.FORCE_COLOR === '1';
const ANSI = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  reset: '\x1b[0m'
};

// Custom format to inject ANSI color codes when forcing colors (avoids relying on TTY)
const forceColorFormat = format((info) => {
  const lvl = String(info.level || 'info');
  const colorName = levelColors[lvl] || 'gray';
  const code = ANSI[colorName] || '';
  info.level = `${code}${lvl}${ANSI.reset}`;
  if (info.label) info.label = `${ANSI.gray}${info.label}${ANSI.reset}`;
  return info;
});

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
  if (forceColor) {
    // Force ANSI-coded colors even when stdout isn't a TTY
    logger.add(new transports.Console({ format: combine(forceColorFormat(), timestamp({ format: shortTimestamp }), consoleFormat) }));
  } else {
    logger.add(new transports.Console({ format: combine(colorize({ all: true }), timestamp({ format: shortTimestamp }), consoleFormat) }));
  }
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
