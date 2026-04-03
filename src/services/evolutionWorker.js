const db = require('../db');
const utils = require('../utils');
const logger = utils.logger.get('evolutionWorker');
const { safeLogMemory } = require('../lib/safeUtils');
const { ContainerBuilder, TextDisplayBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const evolutionsCfg = require('../../config/evolutions.json');
const emojisCfg = require('../../config/emojis.json');
const workerConfig = require('../config/workers');
let shuttingDown = false;

function getRoleDisplay(roleId) {
  const key = String(roleId || '').toLowerCase();
  const roleInfo = evolutionsCfg?.roles?.[key] || {};
  const display = roleInfo.display || key || workerConfig.evolution.defaultRoleDisplay;
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
  if (shuttingDown) return 0;
  // Log memory at start if diagnostics enabled
  safeLogMemory(logger, 'processDueJobs memory start');

  const now = Date.now();
  const jobs = await db.knex('evolution_queue').where({ status: 'queued' }).andWhere('finishes_at', '<=', now).limit(workerConfig.evolution.maxJobsPerRun);
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
          // Prefer pathway-specific next-stage mapping from evolutions config (robust against generic target names)
          try {
            const evolveCmd = require('../commands/evolve');
            const fromRole = currentXeno?.role || currentXeno?.stage || '';
            const pathwayKey = currentXeno?.pathway || 'standard';
            const stepReq = evolveCmd.findRequirement(evolutionsCfg, pathwayKey, fromRole);
            if (stepReq && stepReq.to) {
              targetRole = String(stepReq.to);
            } else {
              targetRole = xenoModel.canonicalizeFacehugger(pathwayKey, job.target_role);
            }
          } catch (_) {
            targetRole = xenoModel.canonicalizeFacehugger(currentXeno?.pathway || 'standard', job.target_role);
          }
        } catch (e) { /* ignore */ void 0; }
        // Determine whether the target role belongs to a different pathway and update pathway as well
        const updates = { role: targetRole, stage: targetRole, updated_at: db.knex.fn.now() };
        try {
          // Find pathway that contains the targetRole in its stages (if any)
          const pathKeys = Object.keys(evolutionsCfg.pathways || {});
          for (const pk of pathKeys) {
            const p = evolutionsCfg.pathways[pk];
            if (p && Array.isArray(p.stages) && p.stages.includes(targetRole)) {
              // If pathway differs from current, set it so the xeno is correctly scoped
              if (String(currentXeno?.pathway || 'standard') !== String(pk)) {
                updates.pathway = String(pk);
              }
              break;
            }
          }
        } catch (e) { /* ignore pathway detection errors */ }

        await db.knex('xenomorphs').where({ id: job.xeno_id }).update(updates);
        await db.knex('evolution_queue').where({ id: job.id }).update({ status: 'completed', result: 'success', updated_at: db.knex.fn.now() });
        try {
          // Prefer cached user object to avoid hitting Discord API when possible
          const uid = String(job.user_id);
          let user = client.users.cache.get(uid) || null;
          if (!user && typeof client.users.fetch === 'function') {
            try {
              user = await client.users.fetch(uid).catch(() => null);
            } catch (_) { user = null; }
          }
          if (user) {
            try {
              await user.send(buildEvolutionCompleteV2Dm(job, fromRole, targetRole));
            } catch (v2Err) {
              try { await user.send(`Your evolution job [${job.id}] completed\n${getRoleDisplay(fromRole)} [${job.xeno_id}] -> ${getRoleDisplay(targetRole)} [${job.xeno_id}]`); } catch (_) { /* ignore */ }
            }
          }
        } catch (dmErr) {
          logger.warn('Failed to DM user about evolution completion', { jobId: job.id, error: dmErr && (dmErr.stack || dmErr) });
          if (shuttingDown) {
            logger.info('Evolution worker start called while shutting down; ignoring');
            return;
          }
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
  safeLogMemory(logger, 'processDueJobs memory end');
  return jobs.length;
}

let _interval = null;
async function start(client, opts = {}) {
  const pollMs = opts.pollMs || workerConfig.evolution.pollMs;
  if (_interval) clearInterval(_interval);
  shuttingDown = false;
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
    shuttingDown = true;
    if (_interval) clearInterval(_interval);
    _interval = null;
    logger.info('Evolution worker stopped');
  } catch (e) {
    logger.warn('Failed stopping evolution worker', { error: e && (e.stack || e) });
  }
}

module.exports = { start, processDueJobs, stop };
