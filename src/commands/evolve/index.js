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
  SectionBuilder,
  SeparatorBuilder,
    SeparatorSpacingSize,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const xenoModel = require('../../models/xenomorph');
const hostModel = require('../../models/host');
const userModel = require('../../models/user');
const db = require('../../db');
const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const { checkCommandRateLimit } = require('../../utils/rateLimiter');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const { getPaginationState, buildPaginationRow } = require('../../utils/pagination');
const safeReply = require('../../utils/safeReply');
const hostsCfg = require('../../../config/hosts.json');
const emojisCfg = require('../../../config/emojis.json');
const evolutionsCfg = require('../../../config/evolutions.json');
const cmd = { name: 'evolve', description: 'Evolve your xenomorphs' };
const EVOLVE_LIST_PAGE_SIZE = 5;
const EVOLVE_CANCEL_PAGE_SIZE = 10;

function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findRequirement(evol, pathwayRaw, fromRaw) {
  if (!evol || !evol.requirements) return null;
  const pathKeys = Object.keys(evol.requirements || {});
  const targetPathKey = pathKeys.find(k => normalizeKey(k) === normalizeKey(pathwayRaw)) || pathwayRaw;
  const reqByPath = evol.requirements[targetPathKey] || {};
  const fromKeys = Object.keys(reqByPath || {});
  const foundKey = fromKeys.find(k => normalizeKey(k) === normalizeKey(fromRaw));
  return foundKey ? reqByPath[foundKey] : null;
}

function getHostDisplay(hostType, cfgHosts, emojis) {
  const hostInfo = cfgHosts[hostType] || {};
  const display = hostInfo.display || hostType;
  const emojiKey = hostInfo.emoji;
  const emoji = emojiKey && emojis[emojiKey] ? emojis[emojiKey] : '';
  return emoji ? `${emoji} ${display}` : display;
}

function getRoleDisplay(roleId) {
  const key = String(roleId || '').toLowerCase();
  const roleInfo = (evolutionsCfg && evolutionsCfg.roles && evolutionsCfg.roles[key]) ? evolutionsCfg.roles[key] : {};
  const display = roleInfo.display || roleId || 'Unknown';
  const emojiKey = roleInfo.emoji;
  const emoji = emojiKey && emojisCfg[emojiKey] ? `${emojisCfg[emojiKey]} ` : '';
  return `${emoji}${display}`.trim();
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

function disableRowComponents(row) {
  try {
    if (row && Array.isArray(row.components)) {
      for (const component of row.components) {
        if (component && typeof component.setDisabled === 'function') {
          component.setDisabled(true);
        }
      }
    }
  } catch (_) {}
  return row;
}

function isDeveloper(interaction) {
  const cfg = require('../../../config/config.json');
  const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
  if (ownerId && interaction.user.id === ownerId) return true;
  
  const testerRoles = (cfg && Array.isArray(cfg.testerRoles)) ? cfg.testerRoles.map(r => String(r)) : [];
  if (testerRoles.length > 0 && interaction.member && interaction.member.roles) {
    if (typeof interaction.member.roles.has === 'function') {
      return testerRoles.some(roleId => interaction.member.roles.has(roleId));
    }
    if (interaction.member.roles.cache) {
      return testerRoles.some(roleId => interaction.member.roles.cache.has(roleId));
    }
  }
  
  return false;
}

function renderInfoText(xeno, evol) {
  const pathwayKey = xeno.pathway || 'standard';
  const pathway = (evol && evol.pathways && evol.pathways[pathwayKey])
    ? evol.pathways[pathwayKey]
    : (evol && evol.pathways && evol.pathways.standard) ? evol.pathways.standard : null;
  const roleMap = (evol && evol.roles) ? evol.roles : {};
  const formatDuration = require('../../utils/formatDuration');

  let out = `**#${xeno.id} ${xeno.role || xeno.stage}**\nPathway: ${pathwayKey}`;
  // show pathway default evolution time if configured
  try {
    const rawPathTime = pathway && (pathway.time || pathway.time_ms);
    const parsed = require('../../utils/parseDuration')(rawPathTime || pathway && pathway.time_ms || null);
    if (parsed) out += `\nDefault evolution time: ${formatDuration(parsed)}`;
  } catch (_) {}
  if (pathway && Array.isArray(pathway.stages)) {
    const stages = pathway.stages.map(s => ({ id: s, label: (roleMap[s] && roleMap[s].display) ? roleMap[s].display : s }));
    const currentStageId = xeno.role || xeno.stage || null;
    out += '\n\nPathway stages:\n';
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const marker = (currentStageId && String(s.id) === String(currentStageId)) ? '◉' : '○';
      // Check for per-step override time
      let stepTimeLabel = '';
      try {
        const req = findRequirement(evol, pathwayKey, s.id);
        const raw = req && (req.time || req.time_ms);
        const parsed = require('../../utils/parseDuration')(raw || null);
        if (parsed) stepTimeLabel = ` (time: ${formatDuration(parsed)})`;
      } catch (_) {}
      out += `${marker} ${s.label}${i === stages.length - 1 ? ' (final)' : ''}${stepTimeLabel}\n`;
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
  listPage = 0,
  listTypeFilter = 'all',
  cancelPage = 0,
  message = null,
  expired = false,
  client = null
}) {
  const container = new ContainerBuilder();

  const titleMap = {
    'list': 'Evolve',
    'info': 'Evolve',
    'cancel': 'Evolve',
    'start-help': 'Evolve',
    'result': 'Evolve'
  };

  addV2TitleWithBotThumbnail({ container, title: titleMap[screen] || 'Evolve', client });
  // Short descriptive text explaining the current view
  const screenDescriptions = {
    list: 'Shows your xenomorphs. Use Info to inspect, Start to begin an evolution, or Cancel to stop queued jobs.',
    info: 'Details for the selected xenomorph: pathway, current stage, and configured evolution times.',
    cancel: 'Shows your queued evolution jobs (can cancel jobs here). Resources are not refunded on cancel.',
    'start-help': 'Start an evolution by choosing a xenomorph, the next stage, and an optional host (required for some pathways).',
    result: ''
  };
  if (screenDescriptions[screen]) {
    try { container.addTextDisplayComponents(new TextDisplayBuilder().setContent(screenDescriptions[screen])); } catch (_) {}
  }

  if (screen === 'list') {
    const safeFilter = String(listTypeFilter || 'all');
    const filteredXenos = safeFilter === 'all'
      ? xenos
      : xenos.filter(x => String(x.role || x.stage || '').toLowerCase() === safeFilter);

    if (!filteredXenos.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no xenomorphs.'));
    } else {
      const pagination = getPaginationState({
        items: filteredXenos,
        pageIdx: listPage,
        pageSize: EVOLVE_LIST_PAGE_SIZE
      });

      for (const x of pagination.pageItems) {
        const primary = getRoleDisplay(x.role || x.stage || '');
        const pathway = x.pathway || 'standard';
        const section = new SectionBuilder()
          .setSecondaryButtonAccessory((button) =>
            button
              .setLabel('Info')
              .setCustomId(`evolve-list-info:${x.id}`)
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${primary} [${x.id}]\nPath: ${pathway}`)
          );
        container.addSectionComponents(section);
      }

      const typeValues = [...new Set(xenos.map(x => String(x.role || x.stage || '').toLowerCase()).filter(Boolean))].sort();
      const MAX_TYPE_OPTIONS = 25; // increase to show more types (Discord limit ~25 options)
      const slicedTypes = typeValues.slice(0, MAX_TYPE_OPTIONS);
      if (safeFilter !== 'all' && safeFilter && !slicedTypes.includes(safeFilter) && typeValues.includes(safeFilter)) {
        slicedTypes[MAX_TYPE_OPTIONS - 1] = safeFilter;
      }

      // If there are more types than the max, reserve the last option for "More..." which opens a modal search
      const baseOptions = slicedTypes.map(v => ({ label: v, value: v, default: v === safeFilter }));
      let options = [{ label: 'All Types', value: 'all', default: safeFilter === 'all' }].concat(baseOptions);
      if (typeValues.length > MAX_TYPE_OPTIONS) {
        // replace last option with More...
        if (options.length >= MAX_TYPE_OPTIONS) options = options.slice(0, MAX_TYPE_OPTIONS - 1);
        options.push({ label: 'More...', value: 'more', default: false });
      }

      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('evolve-list-type-select')
            .setPlaceholder('Filter by xenomorph type')
            .setDisabled(!!expired)
            .addOptions(...options)
        )
      );

      const listPaginationRow = buildPaginationRow({
        prefix: 'evolve-list',
        pageIdx: pagination.safePageIdx,
        totalPages: pagination.totalPages,
        totalItems: pagination.totalItems,
        prevLabel: 'Prev',
        nextLabel: 'Next',
        totalLabel: 'Total',
        showPageInfo: true
      });
      if (expired) disableRowComponents(listPaginationRow);
      container.addActionRowComponents(listPaginationRow);
    }
  } else if (screen === 'info') {
    if (!xenos.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no xenomorphs to inspect.'));
    } else {
      const selected = xenos.find(x => String(x.id) === String(selectedXenoId)) || xenos[0];
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(renderInfoText(selected, require('../../../config/evolutions.json'))));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('evolve-info-select')
            .setPlaceholder('Choose a xenomorph')
            .setDisabled(!!expired)
            .addOptions(...xenos.slice(0, 25).map(x => ({
              label: `${x.role || x.stage} [${x.id}]`.slice(0, 100),
              value: String(x.id),
              default: String(x.id) === String(selected.id)
            })))
        )
      );
    }
  } else if (screen === 'cancel') {
    if (!jobs.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have no queued evolution jobs.'));
    } else {
      const pagination = getPaginationState({
        items: jobs,
        pageIdx: cancelPage,
        pageSize: EVOLVE_CANCEL_PAGE_SIZE
      });
      const pageJobs = pagination.pageItems;

      // Render each job as a section with a Cancel button accessory (like the Info button on list)
      for (const j of pageJobs) {
        const fromRole = j.xeno_role || j.xeno_stage || '';
        const fromDisplay = getRoleDisplay(fromRole);
        const toDisplay = getRoleDisplay(j.target_role);
        const line = `${fromDisplay} [${j.xeno_id}] -> ${toDisplay} [${j.xeno_id}]`;

        const section = new SectionBuilder()
          .setSecondaryButtonAccessory((button) =>
            button
              .setLabel('Cancel')
              .setCustomId(`evolve-cancel-job:${j.id}`)
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(line)
          );
        container.addSectionComponents(section);
      }

      const cancelPaginationRow = buildPaginationRow({
        prefix: 'evolve-cancel',
        pageIdx: pagination.safePageIdx,
        totalPages: pagination.totalPages,
        totalItems: pagination.totalItems,
        prevLabel: 'Prev',
        nextLabel: 'Next',
        totalLabel: 'Total',
        showPageInfo: true
      });
      if (expired) disableRowComponents(cancelPaginationRow);
      container.addActionRowComponents(cancelPaginationRow);
    }
  } else if (screen === 'start-help') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Use `/evolve start` with:\n- `xenomorph`\n- `next_stage`\n- optional `host` (required for some pathways)')
    );
  } else if (screen === 'result') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(message || 'Done.'))
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );
  container.addActionRowComponents(buildNavigationRow({ screen, disabled: !!expired }));

  return [container];
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: buildSubcommandOptions('evolve', [
      {type: 1, name: 'start', description: 'Start evolution (placeholder)', options: [
        {type: 4, name: 'xenomorph', description: 'Which xenomorph to evolve', required: true, autocomplete: true},
        {type:3, name: 'next_stage', description: 'Next stage to evolve into', required: true, autocomplete: true},
        {type: 4, name: 'host', description: 'Host to consume (required for some pathways)', required: false, autocomplete: true}
      ]},
      {type: 1, name: 'list', description: 'List your xenomorphs (placeholder)'},
      {type: 1, name: 'info', description: 'Show evolution info (placeholder)'},
      {type: 1, name: 'cancel', description: 'Cancel an ongoing evolution (placeholder)', options: [{type: 4, name: 'job_id', description: 'Evolution job id', required: false, autocomplete: true}]}
    ])
  },

  async executeInteraction(interaction) {
    // Rate limit check for evolution operations
    if (!await checkCommandRateLimit(interaction, 'expensive')) {
      return; // Rate limit message already sent
    }

    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const subCfg = sub ? (getCommandConfig(`evolve ${sub}`) || getCommandConfig(`evolve.${sub}`)) : null;
    if (subCfg && subCfg.developerOnly) {
      if (!isDeveloper(interaction)) {
        const safeReply = require('../../utils/safeReply');
        await safeReply(interaction, { content: 'Only bot developers/testers can run this subcommand.', ephemeral: true }, { loggerName: 'command:evolve' });
        return;
      }
    }
    await interaction.deferReply({ ephemeral: true });
    const respond = (payload) => safeReply(interaction, payload, { loggerName: 'command:evolve' });
    try {
      const userId = String(interaction.user.id);
      const guildId = interaction.guildId;
      const hydrated = await hydrateLegacyFacehuggers(userId, interaction.guildId);
      const loadXenos = async () => await xenoModel.listByOwner(userId);
      const loadJobs = async (ownerId) => await db.knex('evolution_queue as q')
        .leftJoin('xenomorphs as x', 'q.xeno_id', 'x.id')
        .select('q.*', 'x.role as xeno_role', 'x.stage as xeno_stage')
        .where({ 'q.user_id': ownerId, 'q.status': 'queued' })
        .orderBy('q.id', 'asc');

      if (sub === 'list') {
        const list = await loadXenos();
        const prefix = hydrated > 0 ? `Converted ${hydrated} legacy facehugger item(s) into xenomorphs.` : null;
        await respond({ components: buildEvolveView({ screen: 'list', xenos: list, listPage: 0, listTypeFilter: 'all', message: prefix, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
      } else if (sub === 'start') {
        const xenoId = interaction.options.getInteger('xenomorph');
        const hostId = interaction.options.getInteger('host');
        const target = String(interaction.options.getString('next_stage') || '').trim().toLowerCase();
        const xeno = await xenoModel.getById(xenoId);
        if (!xeno) {
          await respond({ components: buildEvolveView({ screen: 'result', message: 'Xenomorph not found.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
        } else if (String(xeno.owner_id) !== userId) {
          await respond({ components: buildEvolveView({ screen: 'result', message: 'You do not own this xenomorph.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
        } else {
          const existingJob = await db.knex('evolution_queue')
            .where({ xeno_id: xenoId, user_id: userId, status: 'queued' })
            .first();
          if (existingJob) {
            await respond({ components: buildEvolveView({ screen: 'result', message: `This xenomorph already has a queued evolution (job #${existingJob.id}).`, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else {
            const evol = require('../../../config/evolutions.json');
            const pathwayKey = String(xeno.pathway || 'standard');
            const fromStage = String(xeno.role || xeno.stage || '');
            const stepReq = findRequirement(evol, pathwayKey, fromStage);

            if (!stepReq) {
              await respond({ components: buildEvolveView({ screen: 'result', message: `No evolution step is configured for stage ${fromStage} in pathway ${pathwayKey}.`, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
            } else if (String(stepReq.to) !== String(target)) {
              await respond({ components: buildEvolveView({ screen: 'result', message: `Invalid target for ${fromStage} in ${pathwayKey}. Next allowed stage is ${stepReq.to}.`, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
            } else {
              let hostValidationFailed = false;
              if (Array.isArray(stepReq.requires_host_types) && stepReq.requires_host_types.length > 0) {
                if (!hostId) {
                  await respond({ components: buildEvolveView({ screen: 'result', message: `This evolution requires a host (${stepReq.requires_host_types.join(', ')}). Provide the host option.`, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                  hostValidationFailed = true;
                } else {
                  const host = await hostModel.getHostById(hostId);
                  if (!host) {
                    await respond({ components: buildEvolveView({ screen: 'result', message: 'Host not found.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                    hostValidationFailed = true;
                  } else if (String(host.owner_id) !== userId) {
                    await respond({ components: buildEvolveView({ screen: 'result', message: 'You do not own this host.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                    hostValidationFailed = true;
                  } else {
                    const hostType = String(host.host_type || '').toLowerCase();
                    const allowedTypes = stepReq.requires_host_types.map(h => String(h).toLowerCase());
                    if (!allowedTypes.includes(hostType)) {
                      await respond({ components: buildEvolveView({ screen: 'result', message: `Host type ${host.host_type} is invalid for this evolution. Allowed: ${stepReq.requires_host_types.join(', ')}.`, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                      hostValidationFailed = true;
                    } else {
                      await hostModel.removeHostById(hostId);
                    }
                  }
                }
              }

              if (!hostValidationFailed) {
                // Determine duration: prefer per-step `time_ms`/`time`, then pathway-level `time_ms`/`time`, then fallback 1 hour
                const parseDuration = require('../../utils/parseDuration');
                const pathwayCfg = (evol && evol.pathways && evol.pathways[pathwayKey]) ? evol.pathways[pathwayKey] : null;
                const rawStepTime = stepReq.time_ms ?? stepReq.time ?? null;
                const rawPathTime = pathwayCfg ? (pathwayCfg.time_ms ?? pathwayCfg.time ?? null) : null;
                const resolvedMs = parseDuration(rawStepTime) ?? parseDuration(rawPathTime) ?? 1000 * 60 * 60;
                const defaults = {
                  cost_jelly: Number(stepReq.cost_jelly || 0),
                  time_ms: Number(resolvedMs)
                };
                const jelly = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
                if (jelly < defaults.cost_jelly) {
                  await respond({ components: buildEvolveView({ screen: 'result', message: `Insufficient royal jelly. Need ${defaults.cost_jelly}.`, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                } else {
                  if (defaults.cost_jelly > 0) {
                    await userModel.modifyCurrencyForGuild(String(userId), guildId, 'royal_jelly', -defaults.cost_jelly);
                  }
                  const now = Date.now();
                  const finishes = now + defaults.time_ms;
                  const inserted = await db.knex('evolution_queue').insert({ xeno_id: xenoId, user_id: userId, hive_id: xeno.hive_id || null, target_role: target, started_at: now, finishes_at: finishes, cost_jelly: defaults.cost_jelly, stabilizer_used: false, status: 'queued' });
                  const id = Array.isArray(inserted) ? inserted[0] : inserted;
                  const hostPart = hostId ? `Host #${hostId} consumed.` : '';
                  const evolCfg = require('../../../config/evolutions.json');
                  const emojisUtil = emojisCfg; // already loaded at top
                  function getRoleDisplayLocal(roleId) {
                    const key = String(roleId || '').toLowerCase();
                    const roleInfo = (evolCfg && evolCfg.roles && evolCfg.roles[key]) ? evolCfg.roles[key] : {};
                    const display = roleInfo.display || roleId || 'Unknown';
                    const emojiKey = roleInfo.emoji;
                    const emoji = emojiKey && emojisUtil[emojiKey] ? `${emojisUtil[emojiKey]} ` : '';
                    return `${emoji}${display}`.trim();
                  }

                  const fromDisplay = getRoleDisplayLocal(xeno.role || xeno.stage || '');
                  const toDisplay = getRoleDisplayLocal(target);
                  const jellyEmoji = emojisCfg['royal_jelly'] || '';
                  const finishTs = Math.floor(finishes / 1000);
                  const lines = [];
                  lines.push(`Your evolution job [${id}] started`);
                  lines.push(`${fromDisplay} [${xenoId}] → ${toDisplay} [${xenoId}]`);
                  lines.push(`Cost: ${jellyEmoji} ${defaults.cost_jelly} royal jelly.${hostPart ? ' ' + hostPart : ''}`);
                  lines.push(`Finishes: <t:${finishTs}:R> (<t:${finishTs}:F>)`);

                  await respond({ components: buildEvolveView({ screen: 'result', message: lines.join('\n\n'), client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
                }
              }
            }
          }
        }
      } else if (sub === 'info') {
        const list = await loadXenos();
        const firstId = list.length ? list[0].id : null;
        await respond({ components: buildEvolveView({ screen: 'info', xenos: list, selectedXenoId: firstId, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
      } else if (sub === 'cancel') {
        const jobId = interaction.options.getInteger('job_id');
        if (jobId) {
          const job = await db.knex('evolution_queue').where({ id: jobId }).first();
          if (!job) {
            await respond({ components: buildEvolveView({ screen: 'result', message: 'Job not found.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else if (String(job.user_id) !== userId) {
            await respond({ components: buildEvolveView({ screen: 'result', message: 'You do not own this job.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else if (job.status !== 'queued') {
            await respond({ components: buildEvolveView({ screen: 'result', message: 'Job has already started or completed and cannot be cancelled.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          } else {
            await db.knex('evolution_queue').where({ id: jobId }).del();
            await respond({ components: buildEvolveView({ screen: 'result', message: 'Evolution cancelled. Resources are not refunded.', client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
          }
          } else {
            const jobs = await loadJobs(userId);
            await respond({ components: buildEvolveView({ screen: 'cancel', jobs, cancelPage: 0, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }
      }

      let msg = null;
      try { msg = await interaction.fetchReply(); } catch (_) {}
      if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

      const collector = msg.createMessageComponentCollector({ filter: () => true, time: 120_000 });
      let currentListPage = 0;
      let currentListTypeFilter = 'all';
      let currentCancelPage = 0;

      collector.on('collect', async i => {
        try {
          if (i.user.id !== interaction.user.id) {
            try { await safeReply(i, { content: 'These controls are reserved for the user who opened this view.', ephemeral: true }, { loggerName: 'command:evolve' }); } catch (_) {}
            return;
          }

          const userIdInner = String(i.user.id);
          if (i.customId === 'evolve-list-type-select') {
            const chosen = i.values && i.values[0] ? String(i.values[0]) : 'all';
            if (chosen === 'more') {
              // show modal to get substring
              try {
                const modal = new ModalBuilder().setCustomId('evolve-type-search-modal').setTitle('Search Xenomorph Types');
                const input = new TextInputBuilder().setCustomId('evolve-type-search-input').setLabel('Enter substring to search').setStyle(TextInputStyle.Short).setRequired(true);
                const row = new ActionRowBuilder().addComponents(input);
                modal.addComponents(row);
                await i.showModal(modal);
                // register a one-time handler for the modal submit
                const client = interaction.client;
                const modalHandler = async (modalInteraction) => {
                  try {
                    if (!modalInteraction.isModalSubmit || !modalInteraction.isModalSubmit()) return;
                    if (modalInteraction.customId !== 'evolve-type-search-modal') return;
                    if (String(modalInteraction.user.id) !== String(interaction.user.id)) {
                      await modalInteraction.reply({ content: 'This search modal is not for you.', ephemeral: true });
                      return;
                    }
                    const term = String(modalInteraction.fields.getTextInputValue('evolve-type-search-input') || '').toLowerCase().trim();
                    await modalInteraction.reply({ content: `Searching for "${term}"...`, ephemeral: true });
                    // build type list and find matches
                    const allXenos = await xenoModel.listByOwner(userIdInner);
                    const allTypes = [...new Set(allXenos.map(x => String(x.role || x.stage || '').toLowerCase()).filter(Boolean))].sort();
                    const matches = allTypes.filter(t => t.includes(term));
                    if (!matches || matches.length === 0) {
                      await modalInteraction.followUp({ content: `No matching types found for "${term}".`, ephemeral: true });
                    } else if (matches.length === 1) {
                      // update the list view to filter to this type
                      currentListTypeFilter = matches[0];
                      currentListPage = 0;
                      const list = allXenos;
                      try { await msg.edit({ components: buildEvolveView({ screen: 'list', xenos: list, listPage: currentListPage, listTypeFilter: currentListTypeFilter, client: interaction.client }) }); } catch (_) {}
                      await modalInteraction.followUp({ content: `Filtered to type: ${matches[0]}`, ephemeral: true });
                    } else {
                      const sample = matches.slice(0, 10).map((m, idx) => `${idx + 1}. ${m}`).join('\n');
                      await modalInteraction.followUp({ content: `Found ${matches.length} matches. First results:\n${sample}\nPlease refine your search or pick one exact type from the list.`, ephemeral: true });
                    }
                  } catch (e) {
                    try { await modalInteraction.reply({ content: `Search failed: ${e && (e.message || e)}`, ephemeral: true }); } catch (_) {}
                  } finally {
                    client.removeListener('interactionCreate', modalHandler);
                  }
                };
                interaction.client.on('interactionCreate', modalHandler);
              } catch (e) {
                try { await i.update({ components: buildEvolveView({ screen: 'list', xenos: await xenoModel.listByOwner(userIdInner), listPage: currentListPage, listTypeFilter: currentListTypeFilter, client: interaction.client }) }); } catch (_) {}
              }
            } else {
              currentListTypeFilter = chosen;
              currentListPage = 0;
              const list = await xenoModel.listByOwner(userIdInner);
              await i.update({ components: buildEvolveView({ screen: 'list', xenos: list, listPage: currentListPage, listTypeFilter: currentListTypeFilter, client: interaction.client }) });
            }
            return;
          }

          if (String(i.customId).startsWith('evolve-list-info:')) {
            const selected = String(i.customId).split(':')[1];
            const list = await xenoModel.listByOwner(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'info', xenos: list, selectedXenoId: selected, client: interaction.client }) });
            return;
          }

          if (String(i.customId).startsWith('evolve-cancel-job:')) {
            const jobId = Number(String(i.customId).split(':')[1]);
            if (!jobId) {
              try { await i.update({ components: buildEvolveView({ screen: 'result', message: 'Invalid job id.', client: interaction.client }) }); } catch (_) {}
              return;
            }
            // Load job
            const job = await db.knex('evolution_queue').where({ id: jobId }).first();
            if (!job) {
              await i.update({ components: buildEvolveView({ screen: 'result', message: 'Job not found.', client: interaction.client }) });
              return;
            }
            if (String(job.user_id) !== userIdInner) {
              await i.update({ components: buildEvolveView({ screen: 'result', message: 'You do not own this job.', client: interaction.client }) });
              return;
            }
            if (job.status !== 'queued') {
              await i.update({ components: buildEvolveView({ screen: 'result', message: 'Job has already started or completed and cannot be cancelled.', client: interaction.client }) });
              return;
            }

            // Fetch current xeno role for display
            const currentXeno = await db.knex('xenomorphs').where({ id: job.xeno_id }).first();
            const fromRole = currentXeno ? (currentXeno.role || currentXeno.stage || '') : '';

            // Delete job
            await db.knex('evolution_queue').where({ id: jobId }).del();

            // DM the user to confirm cancellation using V2 components
            try {
              const user = await interaction.client.users.fetch(String(userIdInner));
              if (user) {
                try {
                  const container = new ContainerBuilder();
                  container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Evolution Cancelled'),
                    new TextDisplayBuilder().setContent(`Your evolution job [${jobId}] was cancelled`),
                    new TextDisplayBuilder().setContent(`${getRoleDisplay(fromRole)} [${job.xeno_id}] -> ${getRoleDisplay(job.target_role)} [${job.xeno_id}]`)
                  );
                  await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } catch (_) {}
              }
            } catch (_) {}

            // Refresh cancel screen
            const jobs = await loadJobs(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'cancel', jobs, cancelPage: 0, client: interaction.client }) });
            return;
          }

          if (i.customId === 'evolve-list-prev-page' || i.customId === 'evolve-list-next-page') {
            const isPrev = i.customId === 'evolve-list-prev-page';
            currentListPage = isPrev ? currentListPage - 1 : currentListPage + 1;
            const list = await xenoModel.listByOwner(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'list', xenos: list, listPage: currentListPage, listTypeFilter: currentListTypeFilter, client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-nav-list') {
            currentListPage = 0;
            const list = await xenoModel.listByOwner(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'list', xenos: list, listPage: 0, listTypeFilter: currentListTypeFilter, client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-nav-info') {
            const list = await xenoModel.listByOwner(userIdInner);
            const firstId = list.length ? list[0].id : null;
            await i.update({ components: buildEvolveView({ screen: 'info', xenos: list, selectedXenoId: firstId, client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-nav-cancel') {
            currentCancelPage = 0;
            const jobs = await loadJobs(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'cancel', jobs, cancelPage: currentCancelPage, client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-cancel-prev-page' || i.customId === 'evolve-cancel-next-page') {
            const isPrev = i.customId === 'evolve-cancel-prev-page';
            currentCancelPage = isPrev ? currentCancelPage - 1 : currentCancelPage + 1;
            const jobs = await db.knex('evolution_queue').where({ user_id: userIdInner, status: 'queued' }).orderBy('id', 'asc');
            await i.update({ components: buildEvolveView({ screen: 'cancel', jobs, cancelPage: currentCancelPage, client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-nav-start') {
            await i.update({ components: buildEvolveView({ screen: 'start-help', client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-new-xeno') {
            await i.update({ components: buildEvolveView({ screen: 'start-help', client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-info-select') {
            const selected = i.values && i.values[0] ? i.values[0] : null;
            const list = await xenoModel.listByOwner(userIdInner);
            await i.update({ components: buildEvolveView({ screen: 'info', xenos: list, selectedXenoId: selected, client: interaction.client }) });
            return;
          }
          if (i.customId === 'evolve-cancel-select') {
            const selectedJobId = Number(i.values && i.values[0]);
            const job = await db.knex('evolution_queue').where({ id: selectedJobId }).first();
            if (!job || String(job.user_id) !== userIdInner || job.status !== 'queued') {
              const jobs = await db.knex('evolution_queue').where({ user_id: userIdInner, status: 'queued' }).orderBy('id', 'asc');
              await i.update({ components: buildEvolveView({ screen: 'cancel', jobs, cancelPage: currentCancelPage, message: 'Selected job is no longer cancellable.', client: interaction.client }) });
              return;
            }
            await db.knex('evolution_queue').where({ id: selectedJobId }).del();
            const jobs = await db.knex('evolution_queue').where({ user_id: userIdInner, status: 'queued' }).orderBy('id', 'asc');
            await i.update({ components: buildEvolveView({ screen: 'cancel', jobs, cancelPage: currentCancelPage, message: `Cancelled job #${selectedJobId}.`, client: interaction.client }) });
            return;
          }
        } catch (err) {
          try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:evolve' }); } catch (_) {}
        }
      });

      collector.on('end', async () => {
        try {
          const list = await xenoModel.listByOwner(userId);
          if (msg) {
            await msg.edit({ components: buildEvolveView({ screen: 'list', xenos: list, listPage: 0, expired: true, client: interaction.client }) });
          }
        } catch (_) {}
      });

      return;
    } catch (e) {
      return respond({ components: buildEvolveView({ screen: 'result', message: `Error: ${e && (e.message || e)}`, client: interaction.client }), flags: MessageFlags.IsComponentsV2, ephemeral: true });
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
          if (!list || list.length === 0) return autocomplete(interaction, [], { map: it => ({ name: `${it.role || it.stage} [${it.id}]`, value: it.id }), max: 25 });
          // Filter to xenomorphs that have a configured next evolution step and are not already evolving
          const evol = require('../../../config/evolutions.json');
          const eligible = [];
          // build busy set of xenos with queued evolution jobs
          try {
            const allIds = list.map(x => Number(x.id));
            const busyRows = allIds.length ? await db.knex('evolution_queue').whereIn('xeno_id', allIds).andWhere({ status: 'queued' }).select('xeno_id') : [];
            const busySet = new Set((busyRows || []).map(r => String(r.xeno_id)));
            for (const x of list) {
              const path = String(x.pathway || 'standard');
              const from = String(x.role || x.stage || '');
              const req = findRequirement(evol, path, from);
              if (req && req.to) {
                if (!busySet.has(String(x.id))) eligible.push(x);
              }
            }
          } catch (err) {
            // on DB error, fallback to no suggestions
            try { await interaction.respond([]); } catch (_) {}
            return;
          }
          // Group eligible xenos by `role|pathway` and present aggregated choices
          const groups = new Map();
          for (const x of eligible) {
            const role = x.role || x.stage || 'unknown';
            const pathway = x.pathway || 'standard';
            const key = `${role}::${pathway}`;
            const arr = groups.get(key) || { role, pathway, ids: [] };
            arr.ids.push(Number(x.id));
            groups.set(key, arr);
          }
          const grouped = Array.from(groups.values()).slice(0, 25).map(g => {
            g.ids.sort((a, b) => a - b);
            const rep = g.ids[0];
            const count = g.ids.length;
            const roleLabel = (evol && evol.roles && evol.roles[g.role] && evol.roles[g.role].display) ? evol.roles[g.role].display : g.role;
            return { id: String(rep), name: `${roleLabel} • Pathway: ${g.pathway} (x${count}) [#${rep}]` };
          });
          return autocomplete(interaction, grouped, { map: it => ({ name: it.name, value: Number(it.id) }), max: 25 });
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
              const req = findRequirement(evol, path, from);
              if (req && req.to) {
                const roleCfg = evol && evol.roles && evol.roles[req.to] ? evol.roles[req.to] : null;
                targets = [{ id: req.to, name: roleCfg && roleCfg.display ? roleCfg.display : req.to }];
              }
            }
          }
          // If no specific target found for this xeno, return no options (don't show all roles)
          if (!targets.length) {
            targets = [];
          }
          return autocomplete(interaction, targets, { map: it => ({ name: it.name, value: it.id }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }

      if (sub === 'start' && focusedName === 'host') {
        try {
          const rows = await hostModel.listHostsByOwner(String(userId));
          // Group hosts by host_type and present aggregated choices
          const hostGroups = new Map();
          for (const r of rows) {
            const ht = String(r.host_type || 'unknown');
            const arr = hostGroups.get(ht) || { host_type: ht, ids: [] };
            arr.ids.push(Number(r.id));
            hostGroups.set(ht, arr);
          }
          const hostItems = Array.from(hostGroups.values()).slice(0, 25).map(hg => {
            hg.ids.sort((a, b) => a - b);
            const rep = hg.ids[0];
            const count = hg.ids.length;
            // Use only the host display name here (avoid inserting raw emoji markup into autocomplete labels)
            const hostInfo = (hostsCfg && hostsCfg.hosts && hostsCfg.hosts[hg.host_type]) ? hostsCfg.hosts[hg.host_type] : null;
            const display = hostInfo && hostInfo.display ? hostInfo.display : hg.host_type;
            return { id: String(rep), name: `${display} (x${count}) [#${rep}]` };
          });
          return autocomplete(interaction, hostItems, { map: it => ({ name: it.name, value: Number(it.id) }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }

      // CANCEL: job_id autocomplete - list queued jobs for this user
      if (sub === 'cancel') {
        try {
          const rows = await db.knex('evolution_queue').where({ user_id: String(userId), status: 'queued' }).orderBy('id', 'asc').limit(25);
          if (!rows || rows.length === 0) return autocomplete(interaction, [], { map: it => ({ name: it.id, value: it.id }), max: 25 });
          const items = rows.map(r => ({ id: String(r.id), name: `Job [${r.id}] • Xeno [${r.xeno_id}] -> ${r.target_role}` }));
          return autocomplete(interaction, items, { map: it => ({ name: it.name, value: Number(it.id) }), max: 25 });
        } catch (e) { try { await interaction.respond([]); } catch (_) {} return; }
      }
      try { await interaction.respond([]); } catch (_) {}
    } catch (e) {
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
