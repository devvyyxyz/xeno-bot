const db = require('../db');
const utils = require('../utils');
const logger = utils.logger.get('evolutionWorker');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const evolutionsCfg = require('../../config/evolutions.json');
const emojisCfg = require('../../config/emojis.json');

function getRoleDisplay(roleId) {
  const key = String(roleId || '').toLowerCase();
  const roleInfo = evolutionsCfg?.roles?.[key] || {};
  const display = roleInfo.display || key || 'Unknown';
  const emojiKey = roleInfo.emoji;
  const emoji = emojiKey && emojisCfg[emojiKey] ? `${emojisCfg[emojiKey]} ` : '';
  return `${emoji}${display}`.trim();
}

function buildEvolutionCompleteV2Dm(job, fromRole, toRole) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Evolution Complete`),
    new TextDisplayBuilder().setContent(`Your evolution job [${job.id}] completed`),
    new TextDisplayBuilder().setContent(`${getRoleDisplay(fromRole)} [${job.xeno_id}] -> ${getRoleDisplay(toRole)} [${job.xeno_id}]`)
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

async function processDueJobs(client) {
  const now = Date.now();
  const jobs = await db.knex('evolution_queue').where({ status: 'queued' }).andWhere('finishes_at', '<=', now).limit(20);
  if (!jobs || jobs.length === 0) return 0;
  for (const job of jobs) {
    try {
      await db.knex('evolution_queue').where({ id: job.id }).update({ status: 'processing', updated_at: db.knex.fn.now() });
      const success = true;
      if (success) {
        const currentXeno = await db.knex('xenomorphs').where({ id: job.xeno_id }).first();
        const fromRole = currentXeno?.role || currentXeno?.stage || 'unknown';
        let targetRole = job.target_role;
        try {
          const models = require('../models');
          const xenoModel = models.xenomorph;
          targetRole = xenoModel.canonicalizeFacehugger(currentXeno?.pathway || 'standard', job.target_role);
        } catch (e) { /* ignore */ void 0; }
        await db.knex('xenomorphs').where({ id: job.xeno_id }).update({ role: targetRole, updated_at: db.knex.fn.now() });
        await db.knex('evolution_queue').where({ id: job.id }).update({ status: 'completed', result: 'success', updated_at: db.knex.fn.now() });
        try {
          const user = await client.users.fetch(String(job.user_id));
          if (user) {
            try {
              await user.send(buildEvolutionCompleteV2Dm(job, fromRole, targetRole));
            } catch (v2Err) {
              await user.send(`Your evolution job [${job.id}] completed\n${getRoleDisplay(fromRole)} [${job.xeno_id}] -> ${getRoleDisplay(targetRole)} [${job.xeno_id}]`);
            }
          }
        } catch (dmErr) {
          logger.warn('Failed to DM user about evolution completion', { jobId: job.id, error: dmErr && (dmErr.stack || dmErr) });
        }
      } else {
        await db.knex('evolution_queue').where({ id: job.id }).update({ status: 'failed', result: 'failure', updated_at: db.knex.fn.now() });
        try {
          const user = await client.users.fetch(String(job.user_id));
          if (user) await user.send(`Your evolution job #${job.id} failed.`);
        } catch (dmErr) { /* ignore */ void 0; }
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
  try {
    utils.systemMonitor.registerSystem('evolutionWorker', { name: 'Evolution Worker', shutdown: stop });
  } catch (e) { logger.warn('Failed registering evolutionWorker with systemMonitor', { error: e && (e.stack || e) }); }
}

async function stop() {
  try {
    if (_interval) clearInterval(_interval);
    _interval = null;
    logger.info('Evolution worker stopped');
  } catch (e) {
    logger.warn('Failed stopping evolution worker', { error: e && (e.stack || e) });
  }
}

module.exports = { start, processDueJobs, stop };
