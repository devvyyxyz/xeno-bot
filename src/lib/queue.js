const { Queue, Worker, QueueScheduler } = require('bullmq');
const Redis = require('ioredis');

const connectionOptions = process.env.REDIS_URL ? process.env.REDIS_URL : {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

function createQueue(name, opts = {}) {
  const q = new Queue(name, { connection: connectionOptions, ...opts });
  // Ensure a scheduler exists so delayed/retry jobs are processed
  // It is safe to create multiple schedulers for different queues
   
  new QueueScheduler(name, { connection: connectionOptions });
   
  return q;
}

function createWorker(name, processor, opts = {}) {
  const worker = new Worker(name, processor, { connection: connectionOptions, ...opts });

  // Guard against unhandled worker errors which crash the whole process
  // Log the error and let external monitoring/restart handle recovery.
  worker.on('error', (err) => {
    console.error(`[queue:${name}] worker error:`, err);
  });

  // Log job failures handled by the worker for easier debugging/memory tracing
  worker.on('failed', (job, err) => {
    try {
      const id = job && job.id ? job.id : 'unknown';
      console.error(`[queue:${name}] job failed id=${id}:`, err);
    } catch (e) {
      console.error(`[queue:${name}] job failed (unable to read job id):`, err);
    }
  });

  return worker;
}

module.exports = { createQueue, createWorker };
