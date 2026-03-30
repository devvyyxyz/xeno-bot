const { Queue, Worker, QueueScheduler } = require('bullmq');
const IORedis = require('ioredis');

// Connection options (string or object) used if we need to instantiate
// a new ioredis client. Prefer creating one shared client per process to
// reduce total connections.
const connectionOptions = process.env.REDIS_URL ? process.env.REDIS_URL : {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

let sharedRedis = null;
const schedulers = new Map();

function getSharedRedis() {
  if (sharedRedis) return sharedRedis;
  try {
    sharedRedis = new IORedis(process.env.REDIS_URL ? process.env.REDIS_URL : connectionOptions);
    sharedRedis.on('error', (err) => {
      try { console.error('[queue] redis error', err && (err.stack || err)); } catch (_) { /* ignore */ }
    });
    sharedRedis.on('connect', () => {
      try { console.info('[queue] redis connected'); } catch (_) { /* ignore */ }
    });
  } catch (e) {
    console.warn('[queue] failed creating shared ioredis client, falling back to connection options', e && (e.stack || e));
    sharedRedis = null;
  }
  return sharedRedis;
}

function createQueue(name, opts = {}) {
  const conn = getSharedRedis() || connectionOptions;
  const q = new Queue(name, { connection: conn, ...opts });
  // Ensure a scheduler exists so delayed/retry jobs are processed. Keep
  // a single scheduler instance per queue name to avoid extra connections.
  if (!schedulers.has(name)) {
    try {
      const scheduler = new QueueScheduler(name, { connection: conn });
      schedulers.set(name, scheduler);
    } catch (e) {
      console.warn(`[queue] failed creating QueueScheduler for ${name}`, e && (e.stack || e));
    }
  }
  return q;
}

function createWorker(name, processor, opts = {}) {
  const conn = getSharedRedis() || connectionOptions;
  const worker = new Worker(name, processor, { connection: conn, ...opts });

  // Guard against unhandled worker errors which crash the whole process
  // Log the error and let external monitoring/restart handle recovery.
  worker.on('error', (err) => {
    try { console.error(`[queue:${name}] worker error:`, err); } catch (_) { /* ignore */ }
  });

  // Log job failures handled by the worker for easier debugging/memory tracing
  worker.on('failed', (job, err) => {
    try {
      const id = job && job.id ? job.id : 'unknown';
      console.error(`[queue:${name}] job failed id=${id}:`, err);
    } catch (e) {
      try { console.error(`[queue:${name}] job failed (unable to read job id):`, err); } catch (_) { /* ignore */ }
    }
  });

  return worker;
}

async function closeSharedRedis() {
  try {
    for (const [name, sched] of schedulers.entries()) {
      try {
        if (sched && typeof sched.close === 'function') await sched.close();
      } catch (e) { /* ignore per-scheduler close errors */ }
      schedulers.delete(name);
    }
  } catch (_) { /* ignore */ }
  if (sharedRedis && typeof sharedRedis.quit === 'function') {
    try { await sharedRedis.quit(); } catch (_) { try { sharedRedis.disconnect(); } catch (_) { /* ignore */ } }
  }
  sharedRedis = null;
}

module.exports = { createQueue, createWorker, closeSharedRedis };
