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
  /* eslint-disable no-new */
  new QueueScheduler(name, { connection: connectionOptions });
  /* eslint-enable no-new */
  return q;
}

function createWorker(name, processor, opts = {}) {
  const worker = new Worker(name, processor, { connection: connectionOptions, ...opts });
  return worker;
}

module.exports = { createQueue, createWorker };
