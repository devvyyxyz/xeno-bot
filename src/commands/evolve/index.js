const { ChatInputCommandBuilder } = require('@discordjs/builders');
const xenoModel = require('../../models/xenomorph');
const hostModel = require('../../models/host');
const db = require('../../db');
const { getCommandConfig } = require('../../utils/commandsConfig');
const cmd = { name: 'evolve', description: 'Evolve your xenomorphs' };

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
        .setDescription('Start an evolution')
        .addIntegerOptions(opt => opt.setName('xeno_id').setDescription('Xenomorph id').setRequired(true).setAutocomplete(true))
        .addIntegerOptions(opt => opt.setName('host_id').setDescription('Host id (required for some stages)').setRequired(false).setAutocomplete(true))
        .addStringOptions(opt => opt.setName('target').setDescription('Target role').setRequired(true).setAutocomplete(true))
    )
    .addSubcommands(sub => sub.setName('list').setDescription('List your xenomorphs'))
    .addSubcommands(sub => sub.setName('info').setDescription('Show evolution info').addIntegerOptions(opt => opt.setName('xeno_id').setDescription('Xenomorph id').setRequired(true).setAutocomplete(true)))
    .addSubcommands(sub => sub.setName('cancel').setDescription('Cancel an ongoing evolution').addIntegerOptions(opt => opt.setName('job_id').setDescription('Evolution job id').setRequired(true).setAutocomplete(true))),

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
    try {
      const userId = String(interaction.user.id);
      if (sub === 'list') {
        const list = await xenoModel.listByOwner(userId);
        if (!list.length) return interaction.editReply({ content: 'You have no xenomorphs.' });
        const lines = list.slice(0, 25).map(x => `#${x.id} ${x.role || x.stage} (path: ${x.pathway})`);
        return interaction.editReply({ content: lines.join('\n') });
      }

      if (sub === 'start') {
        const xenoId = interaction.options.getInteger('xeno_id');
        const hostId = interaction.options.getInteger('host_id');
        const target = interaction.options.getString('target');
        const xeno = await xenoModel.getById(xenoId);
        if (!xeno) return interaction.editReply({ content: 'Xenomorph not found.' });
        if (String(xeno.owner_id) !== userId) return interaction.editReply({ content: 'You do not own this xenomorph.' });

        const evol = require('../../../config/evolutions.json');
        const pathwayKey = String(xeno.pathway || 'standard');
        const reqByPath = (evol && evol.requirements && evol.requirements[pathwayKey]) ? evol.requirements[pathwayKey] : {};
        const fromStage = String(xeno.role || xeno.stage || '');
        const stepReq = reqByPath[fromStage] || null;
        if (!stepReq) return interaction.editReply({ content: `No evolution step is configured for stage ${fromStage} in pathway ${pathwayKey}.` });
        if (String(stepReq.to) !== String(target)) {
          return interaction.editReply({ content: `Invalid target for ${fromStage} in ${pathwayKey}. Next allowed stage is ${stepReq.to}.` });
        }

        if (Array.isArray(stepReq.requires_host_types) && stepReq.requires_host_types.length > 0) {
          if (!hostId) return interaction.editReply({ content: `This evolution requires a host (${stepReq.requires_host_types.join(', ')}). Provide host_id.` });
          const host = await hostModel.getHostById(hostId);
          if (!host) return interaction.editReply({ content: 'Host not found.' });
          if (String(host.owner_id) !== userId) return interaction.editReply({ content: 'You do not own this host.' });
          const hostType = String(host.host_type || '').toLowerCase();
          const allowedTypes = stepReq.requires_host_types.map(h => String(h).toLowerCase());
          if (!allowedTypes.includes(hostType)) {
            return interaction.editReply({ content: `Host type ${host.host_type} is invalid for this evolution. Allowed: ${stepReq.requires_host_types.join(', ')}.` });
          }
          await hostModel.removeHostById(hostId);
        }

        const defaults = { cost_jelly: Number(stepReq.cost_jelly || 0), time_ms: 1000 * 60 * 60 };
        const resRow = await db.knex('user_resources').where({ user_id: userId }).first();
        const jelly = resRow ? Number(resRow.royal_jelly || 0) : 0;
        if (jelly < defaults.cost_jelly) return interaction.editReply({ content: `Insufficient royal jelly. Need ${defaults.cost_jelly}.` });
        if (defaults.cost_jelly > 0) {
          await db.knex('user_resources').where({ user_id: userId }).update({ royal_jelly: Math.max(0, jelly - defaults.cost_jelly), updated_at: db.knex.fn.now() });
        }
        const now = Date.now();
        const finishes = now + defaults.time_ms;
        const inserted = await db.knex('evolution_queue').insert({ xeno_id: xenoId, user_id: userId, hive_id: xeno.hive_id || null, target_role: target, started_at: now, finishes_at: finishes, cost_jelly: defaults.cost_jelly, stabilizer_used: false, status: 'queued' });
        const id = Array.isArray(inserted) ? inserted[0] : inserted;
        return interaction.editReply({ content: `Evolution started (job #${id}). It will finish in ~${Math.round(defaults.time_ms / 60000)} minutes.` });
      }

      if (sub === 'info') {
        const xenoId = interaction.options.getInteger('xeno_id');
        const xeno = await xenoModel.getById(xenoId);
        if (!xeno) return interaction.editReply({ content: 'Xenomorph not found.' });
        // Describe evolution pathway using config/evolutions.json
        try {
          const evol = require('../../../config/evolutions.json');
          const pathwayKey = xeno.pathway || 'standard';
          const pathway = (evol && evol.pathways && evol.pathways[pathwayKey]) ? evol.pathways[pathwayKey] : (evol && evol.pathways && evol.pathways.standard) ? evol.pathways.standard : null;
          const roleMap = (evol && evol.roles) ? evol.roles : {};
          let out = `#${xeno.id} ${xeno.role || xeno.stage} — pathway: ${pathwayKey}\n`;
          if (pathway && Array.isArray(pathway.stages)) {
            const stages = pathway.stages.map(s => ({ id: s, label: (roleMap[s] && roleMap[s].display) ? roleMap[s].display : s }));
            const currentStageId = xeno.role || xeno.stage || null;
            out += '\nPathway stages:\n';
            for (let i = 0; i < stages.length; i++) {
              const s = stages[i];
              const marker = (currentStageId && String(s.id) === String(currentStageId)) ? '◉' : '○';
              out += `${marker} ${s.label}${i === stages.length - 1 ? ' (final)' : ''}\n`;
            }
            // show next stage if available
            const idx = stages.findIndex(s => String(s.id) === String(currentStageId));
            if (idx >= 0 && idx < stages.length - 1) {
              out += `\nNext stage: ${stages[idx + 1].label}`;
            } else if (idx === -1) {
              out += `\nCurrent stage not found in pathway.`;
            } else {
              out += `\nThis xenomorph is at the final stage.`;
            }
          } else {
            out += '\nNo pathway information available.';
          }
          return interaction.editReply({ content: out });
        } catch (e) {
          return interaction.editReply({ content: `#${xeno.id} ${xeno.role || xeno.stage} — pathway: ${xeno.pathway}` });
        }
      }

      if (sub === 'cancel') {
        const jobId = interaction.options.getInteger('job_id');
        const job = await db.knex('evolution_queue').where({ id: jobId }).first();
        if (!job) return interaction.editReply({ content: 'Job not found.' });
        if (String(job.user_id) !== userId) return interaction.editReply({ content: 'You do not own this job.' });
        if (job.status !== 'queued') return interaction.editReply({ content: 'Job has already started or completed and cannot be cancelled.' });
        await db.knex('evolution_queue').where({ id: jobId }).del();
        return interaction.editReply({ content: 'Evolution cancelled. Resources are not refunded.' });
      }
    } catch (e) {
      return interaction.editReply({ content: `Error: ${e && (e.message || e)}` });
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

      // START / INFO: if numeric focused -> suggest xeno ids
      if ((sub === 'start' || sub === 'info') && isNumeric && (focusedName === 'xeno_id' || !focusedName)) {
        try {
          const list = await xenoModel.listByOwner(String(userId));
          if (!list || list.length === 0) return autocomplete(interaction, [], { map: it => ({ name: `${it.id} ${it.role || it.stage}`, value: it.id }), max: 25 });
          const items = list.slice(0, 25).map(x => ({ id: String(x.id), name: `#${x.id} ${x.role || x.stage} (${x.pathway || ''})` }));
          return autocomplete(interaction, items, { map: it => ({ name: it.name, value: Number(it.id) }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }

      // START: target autocomplete — if non-numeric focused, suggest roles from evolutions config
      if (sub === 'start' && focusedName === 'target') {
        try {
          const evol = require('../../../config/evolutions.json');
          const xenoId = interaction.options.getInteger('xeno_id');
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

      if (sub === 'start' && focusedName === 'host_id') {
        try {
          const rows = await hostModel.listHostsByOwner(String(userId));
          const items = rows.slice(0, 25).map(r => ({ id: String(r.id), name: `#${r.id} ${r.host_type}` }));
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
