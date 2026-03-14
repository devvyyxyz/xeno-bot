const IORedis = require('ioredis');

const redisOptions = process.env.REDIS_URL ? process.env.REDIS_URL : {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

const client = new IORedis(redisOptions);

client.on('error', (err) => {
  // do not crash the process on Redis errors; log instead
  // logging system can be integrated here
  // eslint-disable-next-line no-console
  console.error('[redis] error', err && err.message ? err.message : err);
});

client.on('connect', () => {
  // eslint-disable-next-line no-console
  console.info('[redis] connected');
});

module.exports = client;
