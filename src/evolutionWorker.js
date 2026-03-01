const db = require('./db');
const logger = require('./utils/logger').get('evolutionWorker');

async function processDueJobs(client) {
  const now = Date.now();
  const jobs = await db.knex('evolution_queue').where({ status: 'queued' }).andWhere('finishes_at', '<=', now).limit(20);
  if (!jobs || jobs.length === 0) return 0;
  for (const job of jobs) {
    try {
      await db.knex('evolution_queue').where({ id: job.id }).update({ status: 'processing', updated_at: db.knex.fn.now() });
      // For now, simple deterministic success (could be chance-based)
      const success = true;
      if (success) {
        // update xenomorph role
        await db.knex('xenomorphs').where({ id: job.xeno_id }).update({ role: job.target_role, updated_at: db.knex.fn.now() });
        await db.knex('evolution_queue').where({ id: job.id }).update({ status: 'completed', result: 'success', updated_at: db.knex.fn.now() });
        // DM the user
        try {
          const user = await client.users.fetch(String(job.user_id));
          if (user) await user.send(`Your evolution job #${job.id} completed: xenomorph #${job.xeno_id} is now ${job.target_role}.`);
        } catch (dmErr) {
          logger.warn('Failed to DM user about evolution completion', { jobId: job.id, error: dmErr && (dmErr.stack || dmErr) });
        }
      } else {
        await db.knex('evolution_queue').where({ id: job.id }).update({ status: 'failed', result: 'failure', updated_at: db.knex.fn.now() });
        try {
          const user = await client.users.fetch(String(job.user_id));
          if (user) await user.send(`Your evolution job #${job.id} failed.`);
        } catch (dmErr) {}
      }
    } catch (e) {
      logger.error('Failed processing evolution job', { job, error: e && (e.stack || e) });
    }
  }
  return jobs.length;
}

let _interval = null;
async function start(client, opts = {}) {
  const pollMs = opts.pollMs || 30 * 1000;
  if (_interval) clearInterval(_interval);
  _interval = setInterval(() => {
    processDueJobs(client).catch(e => logger.error('Worker failed', { error: e && (e.stack || e) }));
  }, pollMs);
  logger.info('Evolution worker started', { pollMs });
}

module.exports = { start, processDueJobs };
