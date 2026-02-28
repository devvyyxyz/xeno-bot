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

// Pick label colors deterministically so categories have distinct colours
const _labelPalette = ['magenta', 'cyan', 'blue', 'yellow', 'green', 'gray'];
const pickLabelColor = (label) => {
  if (!label || typeof label !== 'string') return '';
  let h = 0;
  for (let i = 0; i < label.length; i++) h = ((h << 5) - h + label.charCodeAt(i)) >>> 0;
  const colorName = _labelPalette[h % _labelPalette.length];
  return ANSI[colorName] || '';
};

const shouldColorLabels = () => forceColor || (process.stdout && process.stdout.isTTY);

// Custom format to inject ANSI color codes when forcing colors (avoids relying on TTY)
const forceColorFormat = format((info) => {
  const lvl = String(info.level || 'info');
  const colorName = levelColors[lvl] || 'gray';
  const code = ANSI[colorName] || '';
  info.level = `${code}${lvl}${ANSI.reset}`;
  if (info.label) info.label = `${ANSI.gray}${info.label}${ANSI.reset}`;
  return info;
});

// NOTE: fileTransportFormat is defined after `shortTimestamp` below.

const fileFormat = printf(({ timestamp, level, message, label, stack, ...meta }) => {
  // Sanitize metadata to avoid leaking secrets (DB URLs, tokens, passwords)
  const sanitizeValue = (v) => {
    if (typeof v !== 'string') return v;
    // Mask URL credentials: protocol://user:pass@host -> protocol://user:****@host
    try {
      if (/^[a-zA-Z]+:\/\//.test(v)) {
        try {
          const u = new URL(v);
          if (u.username || u.password) {
            u.password = '****';
            return u.toString();
          }
          return v;
        } catch (e) {
          // fallback to regex masking
          return v.replace(/:\/\/([^:@\/]+):([^@\/]+)@/, '://$1:****@');
        }
      }
    } catch (_) {}
    // Mask obvious tokens/keys
    if (/token|password|passwd|secret|dsn/i.test(v)) return 'REDACTED';
    return v;
  };

  const sanitizeMeta = (m) => {
    const out = {};
    for (const [k, v] of Object.entries(m || {})) {
      if (v === undefined) continue;
      if (k.match(/password|pass|token|secret|dsn|url/i)) {
        // redact or sanitize known sensitive keys
        if (typeof v === 'string') out[k] = sanitizeValue(v);
        else out[k] = 'REDACTED';
      } else if (typeof v === 'object' && v !== null) {
        try { out[k] = JSON.parse(JSON.stringify(v)); } catch (_) { out[k] = String(v); }
      } else {
        out[k] = sanitizeValue(v);
      }
    }
    return out;
  };

  const cleanMeta = sanitizeMeta(meta);
  const metaStr = Object.keys(cleanMeta).length ? ` ${JSON.stringify(cleanMeta)}` : '';
  const msg = stack || message;
  return `${timestamp} [${level}]${label ? ` [${label}]` : ''} ${msg}${metaStr}`;
});

const consoleFormat = printf(({ timestamp, level, message, label, stack }) => {
  const msg = stack || message;
  let labelPart = '';
  if (label) {
    // If label already contains ANSI sequences (e.g. forceColorFormat applied), don't recolor
    const hasAnsi = /\x1b\[/.test(String(label));
    if (!hasAnsi && shouldColorLabels()) {
      const code = pickLabelColor(label);
      labelPart = ` [${code}${label}${ANSI.reset}]`;
    } else {
      labelPart = ` [${label}]`;
    }
  }
  return `${timestamp} [${level}]${labelPart} ${msg}`;
});

// Short UTC timestamp helper: "MM-DD HH:mm" (year removed)
const shortTimestamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

// Determine the format used for file transports. When LOG_FORCE_COLOR is set,
// inject ANSI color codes into file logs as well so hosts that support ANSI
// rendering (web consoles) will display colored log lines.
const fileTransportFormat = forceColor
  ? combine(forceColorFormat(), timestamp({ format: shortTimestamp }), fileFormat)
  : combine(timestamp({ format: shortTimestamp }), fileFormat);

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
      format: fileTransportFormat
    }),
    // Keep a separate error file for quick access
    new transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error', format: fileTransportFormat })
  ],
  exitOnError: false
});

// Console with colors and stack printing in non-production
if (process.env.NODE_ENV !== 'production') {
  if (forceColor) {
    // Force ANSI-coded colors even when stdout isn't a TTY
    logger.add(new transports.Console({ format: combine(forceColorFormat(), timestamp({ format: shortTimestamp }), consoleFormat) }));
  } else {
    // Only colorize the `level` itself via winston; labels are colored above
    logger.add(new transports.Console({ format: combine(colorize({ all: false }), timestamp({ format: shortTimestamp }), consoleFormat) }));
  }
} else {
  // In production: normally no colors, but allow forcing ANSI colors via
  // `LOG_FORCE_COLOR=1` or `FORCE_COLOR=1` for hosts/terminals that support it.
  if (forceColor) {
    logger.add(new transports.Console({ format: combine(forceColorFormat(), timestamp({ format: shortTimestamp }), consoleFormat) }));
  } else {
    // Use the console-friendly format in production too (no meta JSON),
    // but do not inject ANSI codes unless forced. This makes `npm start`
    // output match `npm run dev` while keeping file transports unchanged.
    logger.add(new transports.Console({ format: combine(colorize({ all: false }), timestamp({ format: shortTimestamp }), consoleFormat) }));
  }
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
