const { ChatInputCommandBuilder } = require('@discordjs/builders');
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SecondaryButtonBuilder
} = require('@discordjs/builders');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const xenoModel = require('../../models/xenomorph');
const hostModel = require('../../models/host');
const userModel = require('../../models/user');
const db = require('../../db');
const { getCommandConfig } = require('../../utils/commandsConfig');
const safeReply = require('../../utils/safeReply');
const hostsCfg = require('../../../config/hosts.json');
const emojisCfg = require('../../../config/emojis.json');
const cmd = { name: 'evolve', description: 'Evolve your xenomorphs' };

function getHostDisplay(hostType, cfgHosts, emojis) {
  const hostInfo = cfgHosts[hostType] || {};
  const display = hostInfo.display || hostType;
  const emojiKey = hostInfo.emoji;
  const emoji = emojiKey && emojis[emojiKey] ? emojis[emojiKey] : '';
  return emoji ? `${emoji} ${display}` : display;
}

async function hydrateLegacyFacehuggers(userId, guildId) {
  try {
    const user = await userModel.getUserByDiscordId(String(userId));
    if (!user || !user.data || !user.data.guilds || !user.data.guilds[guildId]) return 0;
    const g = user.data.guilds[guildId];
    const items = (g && g.items) ? g.items : {};
    const qty = Number(items.facehugger || 0);
    if (!qty || qty <= 0) return 0;

    for (let i = 0; i < qty; i++) {
      await xenoModel.createXeno(String(userId), {
        pathway: 'standard',
        role: 'facehugger',
        stage: 'facehugger',
        data: { source: 'legacy_item_facehugger' }
      });
    }

    if (g.items && Object.prototype.hasOwnProperty.call(g.items, 'facehugger')) {
      delete g.items.facehugger;
    }
    await userModel.updateUserDataRawById(user.id, user.data);
    return qty;
  } catch (_) {
    return 0;
  }
}

function buildNavigationRow({ screen = 'list', disabled = false }) {
  return new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder().setCustomId('evolve-nav-list').setLabel('List').setDisabled(disabled || screen === 'list'),
    new SecondaryButtonBuilder().setCustomId('evolve-nav-info').setLabel('Info').setDisabled(disabled || screen === 'info'),
    new SecondaryButtonBuilder().setCustomId('evolve-nav-cancel').setLabel('Cancel Jobs').setDisabled(disabled || screen === 'cancel'),
    new SecondaryButtonBuilder().setCustomId('evolve-nav-start').setLabel('Start Help').setDisabled(disabled || screen === 'start-help'),
    new SecondaryButtonBuilder().setCustomId('evolve-new-xeno').setLabel('Evolve New').setDisabled(disabled)
  );
}

function renderInfoText(xeno, evol) {
  const pathwayKey = xeno.pathway || 'standard';
  const pathway = (evol && evol.pathways && evol.pathways[pathwayKey])
    ? evol.pathways[pathwayKey]
    : (evol && evol.pathways && evol.pathways.standard) ? evol.pathways.standard : null;
  const roleMap = (evol && evol.roles) ? evol.roles : {};

  let out = `**#${xeno.id} ${xeno.role || xeno.stage}**\nPathway: ${pathwayKey}`;
  if (pathway && Array.isArray(pathway.stages)) {
    const stages = pathway.stages.map(s => ({ id: s, label: (roleMap[s] && roleMap[s].display) ? roleMap[s].display : s }));
    const currentStageId = xeno.role || xeno.stage || null;
    out += '\n\nPathway stages:\n';
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const marker = (currentStageId && String(s.id) === String(currentStageId)) ? '◉' : '○';
      out += `${marker} ${s.label}${i === stages.length - 1 ? ' (final)' : ''}\n`;
    }
    const idx = stages.findIndex(s => String(s.id) === String(currentStageId));
    if (idx >= 0 && idx < stages.length - 1) out += `\nNext stage: ${stages[idx + 1].label}`;
    else if (idx === -1) out += '\nCurrent stage not found in pathway.';
    else out += '\nThis xenomorph is at the final stage.';
  } else {
    out += '\n\nNo pathway information available.';
  }
  return out;
}

function buildEvolveView({
  screen = 'list',
  xenos = [],
  jobs = [],
  selectedXenoId = null,
  message = null,
  expired = false
}) {
  const container = new ContainerBuilder();

  if (screen === 'list') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Evolve • List'));
    if (!xenos.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no xenomorphs.'));
    } else {
      const lines = xenos.slice(0, 25).map(x => `**#${x.id} ${x.role || x.stage}**\nPath: ${x.pathway || 'standard'}`);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
    }
  } else if (screen === 'info') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Evolve • Info'));
    if (!xenos.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no xenomorphs to inspect.'));
    } else {
      const selected = xenos.find(x => String(x.id) === String(selectedXenoId)) || xenos[0];
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(renderInfoText(selected, require('../../../config/evolutions.json'))));
      if (!expired) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('evolve-info-select')
              .setPlaceholder('Choose a xenomorph')
              .addOptions(...xenos.slice(0, 25).map(x => ({
                label: `#${x.id} ${x.role || x.stage}`.slice(0, 100),
                value: String(x.id),
                default: String(x.id) === String(selected.id)
              })))
          )
        );
      }
    }
  } else if (screen === 'cancel') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Evolve • Cancel Jobs'));
    if (!jobs.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no queued evolution jobs.'));
    } else {
      const lines = jobs.slice(0, 25).map(j => `**#${j.id}** xeno:${j.xeno_id} → ${j.target_role}`);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
      if (!expired) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('evolve-cancel-select')
              .setPlaceholder('Choose a queued job to cancel')
              .addOptions(...jobs.slice(0, 25).map(j => ({
                label: `#${j.id} x:${j.xeno_id} -> ${j.target_role}`.slice(0, 100),
                value: String(j.id)
              })))
          )
        );
      }
    }
  } else if (screen === 'start-help') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Evolve • Start Help'),
      new TextDisplayBuilder().setContent('Use `/evolve start` with:\n- `xenomorph`\n- `next_stage`\n- optional `host` (required for some pathways)')
    );
  } else if (screen === 'result') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Evolve • Result'),
      new TextDisplayBuilder().setContent(String(message || 'Done.'))
    );
  }

  if (!expired) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    container.addActionRowComponents(buildNavigationRow({ screen, disabled: false }));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Evolve view expired_'));
  }

  return [container];
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description)
    .addSubcommands(sub =>
      sub.setName('start')
        .setDescription('Start the next evolution step for a xenomorph')
        .addIntegerOptions(opt => opt.setName('xenomorph').setDescription('Which xenomorph to evolve').setRequired(true).setAutocomplete(true))
        .addStringOptions(opt => opt.setName('next_stage').setDescription('Next stage to evolve into').setRequired(true).setAutocomplete(true))
        .addIntegerOptions(opt => opt.setName('host').setDescription('Host to consume (required for some pathways)').setRequired(false).setAutocomplete(true))
    )
    .addSubcommands(sub => sub.setName('list').setDescription('List your xenomorphs'))
    .addSubcommands(sub => sub.setName('info').setDescription('Show evolution info and choose xenomorph from a menu'))
    .addSubcommands(sub => sub.setName('cancel').setDescription('Cancel an ongoing evolution').addIntegerOptions(opt => opt.setName('job_id').setDescription('Evolution job id').setRequired(false).setAutocomplete(true))),

  async executeInteraction(interaction) {
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const subCfg = sub ? (getCommandConfig(`evolve ${sub}`) || getCommandConfig(`evolve.${sub}`)) : null;
    if (subCfg && subCfg.developerOnly) {
      const cfg = require('../../../config/config.json');
      const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
      if (!ownerId || interaction.user.id !== ownerId) {
        const safeReply = require('../../utils/safeReply');
        await safeReply(interaction, { content: 'Only the bot developer/owner can run this subcommand.', ephemeral: true }, { loggerName: 'command:evolve' });
        return;
      }
    }
    await interaction.deferReply({ ephemeral: true });
    const respond = (payload) => safeReply(interaction, payload, { loggerName: 'command:evolve' });
    try {
      const userId = String(interaction.user.id);
      const hydrated = await hydrateLegacyFacehuggers(userId, interaction.guildId);
      const loadXenos = async () => await xenoModel.listByOwner(userId);
      const loadJobs = async () => await db.knex('evolution_queue').where({ user_id: userId, status: 'queued' }).orderBy('id', 'asc').limit(25);

      if (sub === 'list') {
        const list = await loadXenos();
        const prefix = hydrated > 0 ? `Converted ${hydrated} legacy facehugger item(s) into xenomorphs.` : null;
        await respond({ components: buildEvolveView({ screen: 'list', xenos: list, message: prefix }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
      } else if (sub === 'start') {
        const xenoId = interaction.options.getInteger('xenomorph');
        const hostId = interaction.options.getInteger('host');
        const target = String(interaction.options.getString('next_stage') || '').trim().toLowerCase();
        const xeno = await xenoModel.getById(xenoId);
        if (!xeno) {
          await respond({ components: buildEvolveView({ screen: 'result', message: 'Xenomorph not found.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
        } else if (String(xeno.owner_id) !== userId) {
          await respond({ components: buildEvolveView({ screen: 'result', message: 'You do not own this xenomorph.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
        } else {
          const existingJob = await db.knex('evolution_queue')
            .where({ xeno_id: xenoId, user_id: userId, status: 'queued' })
            .first();
          if (existingJob) {
            await respond({ components: buildEvolveView({ screen: 'result', message: `This xenomorph already has a queued evolution (job #${existingJob.id}).` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else {
            const evol = require('../../../config/evolutions.json');
            const pathwayKey = String(xeno.pathway || 'standard');
            const reqByPath = (evol && evol.requirements && evol.requirements[pathwayKey]) ? evol.requirements[pathwayKey] : {};
            const fromStage = String(xeno.role || xeno.stage || '');
            const stepReq = reqByPath[fromStage] || null;

            if (!stepReq) {
              await respond({ components: buildEvolveView({ screen: 'result', message: `No evolution step is configured for stage ${fromStage} in pathway ${pathwayKey}.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
            } else if (String(stepReq.to) !== String(target)) {
              await respond({ components: buildEvolveView({ screen: 'result', message: `Invalid target for ${fromStage} in ${pathwayKey}. Next allowed stage is ${stepReq.to}.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
            } else {
              let hostValidationFailed = false;
              if (Array.isArray(stepReq.requires_host_types) && stepReq.requires_host_types.length > 0) {
                if (!hostId) {
                  await respond({ components: buildEvolveView({ screen: 'result', message: `This evolution requires a host (${stepReq.requires_host_types.join(', ')}). Provide the host option.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                  hostValidationFailed = true;
                } else {
                  const host = await hostModel.getHostById(hostId);
                  if (!host) {
                    await respond({ components: buildEvolveView({ screen: 'result', message: 'Host not found.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                    hostValidationFailed = true;
                  } else if (String(host.owner_id) !== userId) {
                    await respond({ components: buildEvolveView({ screen: 'result', message: 'You do not own this host.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                    hostValidationFailed = true;
                  } else {
                    const hostType = String(host.host_type || '').toLowerCase();
                    const allowedTypes = stepReq.requires_host_types.map(h => String(h).toLowerCase());
                    if (!allowedTypes.includes(hostType)) {
                      await respond({ components: buildEvolveView({ screen: 'result', message: `Host type ${host.host_type} is invalid for this evolution. Allowed: ${stepReq.requires_host_types.join(', ')}.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                      hostValidationFailed = true;
                    } else {
                      await hostModel.removeHostById(hostId);
                    }
                  }
                }
              }

              if (!hostValidationFailed) {
                const defaults = { cost_jelly: Number(stepReq.cost_jelly || 0), time_ms: 1000 * 60 * 60 };
                const resRow = await db.knex('user_resources').where({ user_id: userId }).first();
                const jelly = resRow ? Number(resRow.royal_jelly || 0) : 0;
                if (jelly < defaults.cost_jelly) {
                  await respond({ components: buildEvolveView({ screen: 'result', message: `Insufficient royal jelly. Need ${defaults.cost_jelly}.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                } else {
                  if (defaults.cost_jelly > 0) {
                    await db.knex('user_resources').where({ user_id: userId }).update({ royal_jelly: Math.max(0, jelly - defaults.cost_jelly), updated_at: db.knex.fn.now() });
                  }
                  const now = Date.now();
                  const finishes = now + defaults.time_ms;
                  const inserted = await db.knex('evolution_queue').insert({ xeno_id: xenoId, user_id: userId, hive_id: xeno.hive_id || null, target_role: target, started_at: now, finishes_at: finishes, cost_jelly: defaults.cost_jelly, stabilizer_used: false, status: 'queued' });
                  const id = Array.isArray(inserted) ? inserted[0] : inserted;
                  const hostPart = hostId ? ` Host #${hostId} consumed.` : '';
                  await respond({ components: buildEvolveView({ screen: 'result', message: `Evolution started (job #${id}) for xeno #${xenoId} → ${target}. Cost: ${defaults.cost_jelly} royal jelly.${hostPart} Finishes in ~${Math.round(defaults.time_ms / 60000)} minutes.` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                }
              }
            }
          }
        }
      } else if (sub === 'info') {
        const list = await loadXenos();
        const firstId = list.length ? list[0].id : null;
        await respond({ components: buildEvolveView({ screen: 'info', xenos: list, selectedXenoId: firstId }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
      } else if (sub === 'cancel') {
        const jobId = interaction.options.getInteger('job_id');
        if (jobId) {
          const job = await db.knex('evolution_queue').where({ id: jobId }).first();
          if (!job) {
            await respond({ components: buildEvolveView({ screen: 'result', message: 'Job not found.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else if (String(job.user_id) !== userId) {
            await respond({ components: buildEvolveView({ screen: 'result', message: 'You do not own this job.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else if (job.status !== 'queued') {
            await respond({ components: buildEvolveView({ screen: 'result', message: 'Job has already started or completed and cannot be cancelled.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else {
            await db.knex('evolution_queue').where({ id: jobId }).del();
            await respond({ components: buildEvolveView({ screen: 'result', message: 'Evolution cancelled. Resources are not refunded.' }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          }
        } else {
          const jobs = await loadJobs();
          await respond({ components: buildEvolveView({ screen: 'cancel', jobs }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }
      }

      let msg = null;
      try { msg = await interaction.fetchReply(); } catch (_) {}
      if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

      const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id && String(i.customId || '').startsWith('evolve-'),
        time: 120_000
      });

      collector.on('collect', async i => {
        try {
          const userIdInner = String(i.user.id);
          if (i.customId === 'evolve-nav-list') {
            const list = await xenoModel.listByOwner(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'list', xenos: list }) });
            return;
          }
          if (i.customId === 'evolve-nav-info') {
            const list = await xenoModel.listByOwner(userIdInner);
            const firstId = list.length ? list[0].id : null;
            await i.update({ components: buildEvolveView({ screen: 'info', xenos: list, selectedXenoId: firstId }) });
            return;
          }
          if (i.customId === 'evolve-nav-cancel') {
            const jobs = await db.knex('evolution_queue').where({ user_id: userIdInner, status: 'queued' }).orderBy('id', 'asc').limit(25);
            await i.update({ components: buildEvolveView({ screen: 'cancel', jobs }) });
            return;
          }
          if (i.customId === 'evolve-nav-start') {
            await i.update({ components: buildEvolveView({ screen: 'start-help' }) });
            return;
          }
          if (i.customId === 'evolve-new-xeno') {
            await i.update({ components: buildEvolveView({ screen: 'start-help' }) });
            return;
          }
          if (i.customId === 'evolve-info-select') {
            const selected = i.values && i.values[0] ? i.values[0] : null;
            const list = await xenoModel.listByOwner(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'info', xenos: list, selectedXenoId: selected }) });
            return;
          }
          if (i.customId === 'evolve-cancel-select') {
            const selectedJobId = Number(i.values && i.values[0]);
            const job = await db.knex('evolution_queue').where({ id: selectedJobId }).first();
            if (!job || String(job.user_id) !== userIdInner || job.status !== 'queued') {
              const jobs = await db.knex('evolution_queue').where({ user_id: userIdInner, status: 'queued' }).orderBy('id', 'asc').limit(25);
              await i.update({ components: buildEvolveView({ screen: 'cancel', jobs, message: 'Selected job is no longer cancellable.' }) });
              return;
            }
            await db.knex('evolution_queue').where({ id: selectedJobId }).del();
            const jobs = await db.knex('evolution_queue').where({ user_id: userIdInner, status: 'queued' }).orderBy('id', 'asc').limit(25);
            await i.update({ components: buildEvolveView({ screen: 'cancel', jobs, message: `Cancelled job #${selectedJobId}.` }) });
            return;
          }
        } catch (err) {
          try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:evolve' }); } catch (_) {}
        }
      });

      collector.on('end', async () => {
        try {
          const list = await xenoModel.listByOwner(userId);
          await safeReply(interaction, { components: buildEvolveView({ screen: 'list', xenos: list, expired: true }), flags: MessageFlags.IsComponentsV2, ephemeral: true }, { loggerName: 'command:evolve' });
        } catch (_) {}
      });

      return;
    } catch (e) {
      return respond({ components: buildEvolveView({ screen: 'result', message: `Error: ${e && (e.message || e)}` }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
    }
  }
  ,
  async autocomplete(interaction) {
    try {
      const autocomplete = require('../../utils/autocomplete');
      // detect subcommand safely
      let sub = null;
      try { sub = interaction.options && interaction.options.getSubcommand ? (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })() : null; } catch (e) { sub = null; }
      const userId = interaction.user.id;
      // determine focused text and whether numeric
      const focusedRaw = interaction.options.getFocused?.();
      const focusedNamed = interaction.options.getFocused ? interaction.options.getFocused(true) : null;
      const focusedName = focusedNamed && focusedNamed.name ? String(focusedNamed.name) : null;
      const focused = focusedRaw && typeof focusedRaw === 'object' ? String(focusedRaw.value || '') : String(focusedRaw || '');
      const isNumeric = /^[0-9]+$/.test(focused);

      if (sub === 'start' && focusedName === 'xenomorph') {
        await hydrateLegacyFacehuggers(String(userId), interaction.guildId);
      }

      // START / INFO: if numeric focused -> suggest xeno ids
      if (sub === 'start' && (focusedName === 'xenomorph' || (!focusedName && isNumeric))) {
        try {
          const list = await xenoModel.listByOwner(String(userId));
          if (!list || list.length === 0) return autocomplete(interaction, [], { map: it => ({ name: `${it.id} ${it.role || it.stage}`, value: it.id }), max: 25 });
          const items = list.slice(0, 25).map(x => ({ id: String(x.id), name: `#${x.id} ${x.role || x.stage} (${x.pathway || ''})` }));
          return autocomplete(interaction, items, { map: it => ({ name: it.name, value: Number(it.id) }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }

      // START: target autocomplete — if non-numeric focused, suggest roles from evolutions config
      if (sub === 'start' && focusedName === 'next_stage') {
        try {
          const evol = require('../../../config/evolutions.json');
          const xenoId = interaction.options.getInteger('xenomorph');
          let targets = [];
          if (xenoId) {
            const xeno = await xenoModel.getById(xenoId);
            if (xeno) {
              const path = String(xeno.pathway || 'standard');
              const from = String(xeno.role || xeno.stage || '');
              const req = evol && evol.requirements && evol.requirements[path] ? evol.requirements[path][from] : null;
              if (req && req.to) {
                const roleCfg = evol && evol.roles && evol.roles[req.to] ? evol.roles[req.to] : null;
                targets = [{ id: req.to, name: roleCfg && roleCfg.display ? `${req.to} — ${roleCfg.display}` : req.to }];
              }
            }
          }
          if (!targets.length) {
            const roles = evol && evol.roles ? Object.keys(evol.roles).map(k => ({ id: k, name: `${k}${evol.roles[k].display ? ` — ${evol.roles[k].display}` : ''}` })) : [];
            targets = roles;
          }
          return autocomplete(interaction, targets, { map: it => ({ name: it.name, value: it.id }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }

      if (sub === 'start' && focusedName === 'host') {
        try {
          const rows = await hostModel.listHostsByOwner(String(userId));
          const items = rows.slice(0, 25).map(r => ({ id: String(r.id), name: `#${r.id} ${getHostDisplay(r.host_type, hostsCfg.hosts || {}, emojisCfg)}` }));
          return autocomplete(interaction, items, { map: it => ({ name: it.name, value: Number(it.id) }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }

      // CANCEL: job_id autocomplete - list queued jobs for this user
      if (sub === 'cancel') {
        try {
          const rows = await db.knex('evolution_queue').where({ user_id: String(userId), status: 'queued' }).orderBy('id', 'asc').limit(25);
          if (!rows || rows.length === 0) return autocomplete(interaction, [], { map: it => ({ name: it.id, value: it.id }), max: 25 });
          const items = rows.map(r => ({ id: String(r.id), name: `#${r.id} xeno:${r.xeno_id} -> ${r.target_role}` }));
          return autocomplete(interaction, items, { map: it => ({ name: it.name, value: Number(it.id) }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }
      try { await interaction.respond([]); } catch (_) {}
    } catch (e) {
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
