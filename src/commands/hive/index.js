const { ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { ActionRowBuilder, SecondaryButtonBuilder, PrimaryButtonBuilder, DangerButtonBuilder } = require('@discordjs/builders');
const hiveModel = require('../../models/hive');
const xenomorphModel = require('../../models/xenomorph');
const userResources = require('../../models/userResources');
const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const hiveTypes = require('../../../config/hiveTypes.json');
const hiveDefaults = require('../../../config/hiveDefaults.json');
const db = require('../../db');
const { formatNumber } = require('../../utils/numberFormat');

const cmd = getCommandConfig('hive') || { name: 'hive', description: 'Manage your hive' };

const HIVE_DELETE_CONFIRM_ID = 'hive-delete-confirm';
const HIVE_DELETE_CANCEL_ID = 'hive-delete-cancel';
const HIVE_ACTION_REFRESH_ID = 'hive-action-refresh';
const HIVE_ACTION_UPGRADE_QUEEN_ID = 'hive-action-upgrade-queen';
const HIVE_ACTION_UPGRADE_MODULE_ID = 'hive-action-upgrade-module';

function buildNavigationRow({ screen, disabled = false }) {
  return new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder().setCustomId('hive-nav-stats').setLabel('Stats').setDisabled(screen === 'stats' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-modules').setLabel('Modules').setDisabled(screen === 'modules' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-milestones').setLabel('Milestones').setDisabled(screen === 'milestones' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-queen').setLabel('Queen').setDisabled(screen === 'queen' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-types').setLabel('Types').setDisabled(screen === 'types' || disabled)
  );
}

function getQuickModuleCandidate(modulesRows = []) {
  const modulesCfg = hiveDefaults.modules || {};
  let candidate = null;

  for (const moduleKey of Object.keys(modulesCfg)) {
    const cfg = modulesCfg[moduleKey] || {};
    const moduleRow = Array.isArray(modulesRows) ? modulesRows.find(m => m.module_key === moduleKey) : null;
    const level = moduleRow ? Number(moduleRow.level || 0) : Number(cfg.default_level || 0);
    const maxLevel = Number(cfg.max_level || 0);
    if (maxLevel > 0 && level >= maxLevel) continue;
    const cost = Math.max(1, Math.floor(Number(cfg.base_cost_jelly || 1) * (level + 1)));

    if (!candidate || cost < candidate.cost) {
      candidate = { moduleKey, cfg, level, row: moduleRow, cost };
    }
  }

  return candidate;
}

function buildQuickActionsRow({ disabled = false, canAct = true, queenCost = 50, moduleCandidate = null }) {
  const moduleLabel = moduleCandidate ? `Quick Module (${moduleCandidate.cost} RJ)` : 'Quick Module (MAX)';

  return new ActionRowBuilder().addComponents(
    new PrimaryButtonBuilder()
      .setCustomId(HIVE_ACTION_UPGRADE_QUEEN_ID)
      .setLabel(`Queen +1 (${queenCost} RJ)`)
      .setDisabled(disabled || !canAct),
    new SecondaryButtonBuilder()
      .setCustomId(HIVE_ACTION_UPGRADE_MODULE_ID)
      .setLabel(moduleLabel)
      .setDisabled(disabled || !canAct || !moduleCandidate),
    new SecondaryButtonBuilder()
      .setCustomId(HIVE_ACTION_REFRESH_ID)
      .setLabel('Refresh')
      .setDisabled(disabled)
  );
}

function toDiscordTimestamp(value, style = 'f') {
  const ms = Number(value || 0);
  if (!ms || Number.isNaN(ms)) return 'Unknown';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function buildHiveScreen({ screen = 'stats', hive, targetUser, userId, rows = {}, expired = false, canAct = true, notice = null, client = null }) {
  const container = new ContainerBuilder();
  
  const screenTitles = {
    stats: '## 📊 Hive Stats',
    modules: '## 🔧 Hive Modules',
    milestones: '## 🎯 Hive Milestones',
    queen: '## 👑 Queen Status',
    types: '## ℹ️ Hive Types'
  };

  addV2TitleWithBotThumbnail({ container, title: screenTitles[screen] || screenTitles.stats, client });
  if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(notice));

  const hiveType = hive.type || hive.hive_type || 'default';
  const snapshotLines = [
    `**Owner:** <@${targetUser.id}>`,
    `**Type:** \`${hiveType}\``,
    `**Capacity:** ${hive.capacity || 0}`,
    `**Jelly/hour:** ${hive.jelly_production_per_hour || 0}`,
    `**Queen:** ${hive.queen_xeno_id || 'Unassigned'}`
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(snapshotLines.join(' • ')));

  if (screen === 'stats') {
    const statLines = [
      `**Hive ID:** \`${hive.id || 'unknown'}\``,
      `**Created:** ${toDiscordTimestamp(hive.created_at, 'f')} (${toDiscordTimestamp(hive.created_at, 'R')})`,
      `**Last Updated:** ${toDiscordTimestamp(hive.updated_at, 'f')} (${toDiscordTimestamp(hive.updated_at, 'R')})`
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statLines.join('\n')));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Next actions: Upgrade modules for stronger scaling, then upgrade queen for steady jelly growth._'));
  } else if (screen === 'modules') {
    const modulesCfg = hiveDefaults.modules || {};
    const moduleLines = Object.keys(modulesCfg).map(k => {
      const cfg = modulesCfg[k];
      const moduleRow = rows.modules ? rows.modules.find(r => r.module_key === k) : null;
      const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
      return `**${cfg.display}** (${k})\nLevel ${level} — ${cfg.description}`;
    }).join('\n\n');
    const moduleCount = Object.keys(modulesCfg).length;
    const upgradedCount = Object.keys(modulesCfg).filter(k => {
      const cfg = modulesCfg[k];
      const moduleRow = rows.modules ? rows.modules.find(r => r.module_key === k) : null;
      const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
      return level > (cfg.default_level || 0);
    }).length;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Progress:** ${upgradedCount}/${moduleCount} modules upgraded`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(moduleLines || 'No modules found'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Tip: use `/hive upgrade-module module:<key>` to improve specific bonuses._'));
  } else if (screen === 'milestones') {
    const milestonesCfg = hiveDefaults.milestones || {};
    const milestoneKeys = Object.keys(milestonesCfg);
    const achievedCount = milestoneKeys.filter(k => rows.milestones ? rows.milestones.some(r => r.milestone_key === k && r.achieved) : false).length;
    const milestoneLines = Object.keys(milestonesCfg).map(k => {
      const cfg = milestonesCfg[k];
      const done = rows.milestones ? rows.milestones.some(r => r.milestone_key === k && r.achieved) : false;
      return `${done ? '✅' : '❌'} **${cfg.name || k}** — ${cfg.description || ''}`;
    }).join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Progress:** ${achievedCount}/${milestoneKeys.length || 0} milestones complete`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(milestoneLines || 'No milestones found'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Tip: milestones unlock naturally as you expand and upgrade your hive._'));
  } else if (screen === 'queen') {
    const royalJelly = rows.resources?.royal_jelly || 0;
    const queenReady = hive.queen_xeno_id ? 'Assigned' : 'Needs assignment';
    const queenLines = [
      `**Queen Xeno ID:** ${hive.queen_xeno_id || 'None'}`,
      `**Jelly/hour:** ${hive.jelly_production_per_hour || 0}`,
      `**Royal Jelly (you):** ${royalJelly}`,
      `**Status:** ${queenReady}`
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(queenLines.join('\n')));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Tip: use `/hive upgrade-queen` when you have enough Royal Jelly._'));
  } else if (screen === 'types') {
    const currentType = hiveType;
    const typeLines = Object.values((hiveTypes && hiveTypes.types) || {})
      .map(t => `${t.id === currentType ? '⭐ ' : ''}**${t.name}** (\`${t.id}\`)\n${t.description}`)
      .join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(typeLines || 'No hive types found'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`_Current hive type: \`${currentType}\`_`));
  }

  if (!expired) {
    const moduleCandidate = getQuickModuleCandidate(rows.modules || []);
    container.addActionRowComponents(buildQuickActionsRow({ disabled: false, canAct, queenCost: 50, moduleCandidate }));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    container.addActionRowComponents(buildNavigationRow({ screen, disabled: false }));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Hive view expired_'));
  }

  return [container];
}

function buildNoHiveV2Payload({ includeFlags = true, client = null }) {
  const container = new ContainerBuilder();
  addV2TitleWithBotThumbnail({ container, title: 'No Hive Found', client });
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('You don\'t have a hive yet. Create one to unlock hive features like modules, milestones, and queen upgrades.')
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new PrimaryButtonBuilder()
        .setLabel('Create Hive')
        .setCustomId('hive-create-prompt')
        .setDisabled(false)
    )
  );

  const payload = {
    components: [container]
  };
  if (includeFlags) payload.flags = MessageFlags.IsComponentsV2;
  return payload;
}

function buildHiveDeleteV2Payload({ hiveName, hiveId, state = 'confirm', includeFlags = true, client = null }) {
  const titleMap = {
    confirm: '## Confirm Hive Deletion',
    cancelled: '## Deletion Cancelled',
    deleted: '## Hive Deleted',
    timed_out: '## Timed Out'
  };
  const bodyMap = {
    confirm: `This will permanently delete **${hiveName || 'your hive'}** (ID: ${hiveId}).\n\nAre you sure you want to proceed?`,
    cancelled: 'Hive deletion has been cancelled.',
    deleted: `Deleted hive **${hiveName || 'your hive'}** (ID: ${hiveId}).`,
    timed_out: 'No response received. Hive deletion cancelled.'
  };
  const disableButtons = state !== 'confirm';

  const container = new ContainerBuilder();
  addV2TitleWithBotThumbnail({ container, title: titleMap[state] || titleMap.confirm, client });
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(bodyMap[state] || bodyMap.confirm)
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new DangerButtonBuilder()
        .setLabel('Delete')
        .setCustomId(HIVE_DELETE_CONFIRM_ID)
        .setDisabled(disableButtons),
      new SecondaryButtonBuilder()
        .setLabel('Cancel')
        .setCustomId(HIVE_DELETE_CANCEL_ID)
        .setDisabled(disableButtons)
    )
  );

  const payload = {
    components: [container]
  };
  if (includeFlags) payload.flags = MessageFlags.IsComponentsV2;
  return payload;
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
    options: buildSubcommandOptions('hive', [
      { type: 1, name: 'create', description: 'Create your personal hive (placeholder)' },
      { type: 1, name: 'stats', description: 'Show your hive stats (placeholder)', options: [{ type: 6, name: 'user', description: 'View stats for this user (optional)', required: false}]},
      { type: 1, name: 'modules', description: 'View hive modules (placeholder)' },
      { type: 1, name: 'upgrade-module', description: 'Upgrade a hive module (placeholder)', options: [{type: 3, name: 'module', description: 'Module key to upgrade', required: true}]},
      { type: 1, name: 'milestones', description: 'View milestones and progress (placeholder)' },
      { type: 1, name: 'queen-status', description: 'View queen and jelly production (placeholder)' },
      { type: 1, name: 'upgrade-queen', description: 'Upgrade the queen chamber (placeholder)' },
      { type: 1, name: 'type-info', description: 'Show hive type info (placeholder)', options: [{type: 3, name: 'type', description: 'Which type', required: false, autocomplete: true}]},
      { type: 1, name: 'delete', description: 'Delete your hive (placeholder)' },
      { type: 1, name: 'events', description: 'Show recent hive events (placeholder)' },
      { type: 1, name: 'defend', description: 'Defend against attack (placeholder)' }
    ])
  },

  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    // CREATE
    if (sub === 'create') {
      try {
        let xenos = [];
        try { xenos = await xenomorphModel.getXenosByOwner(userId); } catch (e) { xenos = []; }
        const hasEvolved = Array.isArray(xenos) && xenos.some(x => (x.role && x.role !== 'egg') || (x.stage && x.stage !== 'egg'));
        if (!hasEvolved) return safeReply(interaction, { content: 'You need at least one xenomorph evolved beyond the egg stage to create a hive. Use `/hunt` to find hosts and `/evolve` to progress your xenomorphs.', ephemeral: true });

        const existing = await hiveModel.getHiveByUser(userId, guildId);
        if (existing) return safeReply(interaction, { content: 'You already have a hive in this server.', ephemeral: true });
        const hive = await hiveModel.createHiveForUser(userId, guildId, { type: 'default', name: `${interaction.user.username}'s Hive` });
        return safeReply(interaction, { content: `✅ Hive created (ID: ${hive.id}).`, ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed creating hive: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    try {
      const hive = await hiveModel.getHiveByUser(userId, guildId);
      
      // Commands that require a hive
      const requiresHive = ['modules', 'upgrade-module', 'milestones', 'queen-status', 'upgrade-queen', 'type-info', 'delete'];
      if (!hive && requiresHive.includes(sub)) {
        await safeReply(interaction, {
          ...buildNoHiveV2Payload({ includeFlags: true, client: interaction.client }),
          ephemeral: true
        }, { loggerName: 'command:hive' });

        let msg = null;
        try { msg = await interaction.fetchReply(); } catch (_) {}
        if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

        const collector = msg.createMessageComponentCollector({
          filter: i => i.user.id === userId && i.customId === 'hive-create-prompt',
          time: 60_000,
          max: 1
        });

        collector.on('collect', async i => {
          try {
            let xenos = [];
            try { xenos = await xenomorphModel.getXenosByOwner(userId); } catch (e) { xenos = []; }
            const hasEvolved = Array.isArray(xenos) && xenos.some(x => (x.role && x.role !== 'egg') || (x.stage && x.stage !== 'egg'));
            
            if (!hasEvolved) {
              const container = new ContainerBuilder();
              container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## No Hive Found'),
                new TextDisplayBuilder().setContent('❌ You need at least one xenomorph evolved beyond the egg stage to create a hive.')
              );
              container.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                )
              );
              await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
              return;
            }

            const existing = await hiveModel.getHiveByUser(userId, guildId);
            if (existing) {
              const container = new ContainerBuilder();
              container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Hive Already Exists'),
                new TextDisplayBuilder().setContent('✅ You already have a hive in this server.')
              );
              container.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                )
              );
              await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
              return;
            }

            const newHive = await hiveModel.createHiveForUser(userId, guildId, { type: 'default', name: `${interaction.user.username}'s Hive` });
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent('## Hive Created'),
              new TextDisplayBuilder().setContent(`✅ Hive created (ID: ${newHive.id}).`)
            );
            container.addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
              )
            );
            await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
          } catch (err) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent('## Error'),
              new TextDisplayBuilder().setContent(`Error creating hive: ${err && err.message}`)
            );
            container.addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
              )
            );
            try { await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 }); } catch (_) {}
          }
        });

        return;
      }

      // Handle view-based subcommands (stats, modules, milestones, queen-status, type-info, and old direct view from 'stats')
      if (sub === 'stats' || sub === 'modules' || sub === 'milestones' || sub === 'queen-status') {
        const targetUser = (sub === 'stats' && (() => { try { return interaction.options.getUser('user'); } catch (e) { return null; } })()) || interaction.user;
        let viewHive = (sub === 'stats') ? await hiveModel.getHiveByUser(String(targetUser.id), guildId) : hive;
        const canAct = targetUser.id === userId;
        
        if (!viewHive) {
          if (targetUser.id === userId) {
            await safeReply(interaction, {
              ...buildNoHiveV2Payload({ includeFlags: true, client: interaction.client }),
              ephemeral: true
            }, { loggerName: 'command:hive' });

            let msg = null;
            try { msg = await interaction.fetchReply(); } catch (_) {}
            if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

            const collector = msg.createMessageComponentCollector({
              filter: i => i.user.id === userId && i.customId === 'hive-create-prompt',
              time: 60_000,
              max: 1
            });

            collector.on('collect', async i => {
              try {
                let xenos = [];
                try { xenos = await xenomorphModel.getXenosByOwner(userId); } catch (e) { xenos = []; }
                const hasEvolved = Array.isArray(xenos) && xenos.some(x => (x.role && x.role !== 'egg') || (x.stage && x.stage !== 'egg'));
                
                if (!hasEvolved) {
                  const container = new ContainerBuilder();
                  container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## No Hive Found'),
                    new TextDisplayBuilder().setContent('❌ You need at least one xenomorph evolved beyond the egg stage to create a hive.')
                  );
                  container.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                    )
                  );
                  await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                const existing = await hiveModel.getHiveByUser(userId, guildId);
                if (existing) {
                  const container = new ContainerBuilder();
                  container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Hive Already Exists'),
                    new TextDisplayBuilder().setContent('✅ You already have a hive in this server.')
                  );
                  container.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                    )
                  );
                  await interact.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                const newHive = await hiveModel.createHiveForUser(userId, guildId, { type: 'default', name: `${interaction.user.username}'s Hive` });
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                  new TextDisplayBuilder().setContent('## Hive Created'),
                  new TextDisplayBuilder().setContent(`✅ Hive created (ID: ${newHive.id}).`)
                );
                container.addActionRowComponents(
                  new ActionRowBuilder().addComponents(
                    new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                  )
                );
                await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
              } catch (err) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                  new TextDisplayBuilder().setContent('## Error'),
                  new TextDisplayBuilder().setContent(`Error creating hive: ${err && err.message}`)
                );
                container.addActionRowComponents(
                  new ActionRowBuilder().addComponents(
                    new PrimaryButtonBuilder().setLabel('Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                  )
                );
                try { await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 }); } catch (_) {}
              }
            });
            return;
          } else {
            return safeReply(interaction, { content: `${targetUser.username} does not have a hive yet.`, ephemeral: true });
          }
        }

        let initialScreen = 'stats';
        if (sub === 'modules') initialScreen = 'modules';
        else if (sub === 'milestones') initialScreen = 'milestones';
        else if (sub === 'queen-status') initialScreen = 'queen';

        let modules = [];
        let milestones = [];
        try {
          modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => []);
          milestones = await db.knex('hive_milestones').where({ hive_id: viewHive.id }).select('*').catch(() => []);
        } catch (e) {
          // Silently fail on database errors for optional tables
        }
        let resources = await userResources.getResources(userId);

        await safeReply(interaction, {
          components: buildHiveScreen({ screen: initialScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, client: interaction.client }),
          flags: MessageFlags.IsComponentsV2,
          ephemeral: true
        }, { loggerName: 'command:hive' });

        let msg = null;
        try { msg = await interaction.fetchReply(); } catch (_) {}
        if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

        let currentScreen = initialScreen;

        const collector = msg.createMessageComponentCollector({
          filter: i => i.user.id === userId,
          time: 300_000
        });

        collector.on('collect', async i => {
          try {
            if (i.customId === HIVE_ACTION_REFRESH_ID) {
              const refreshedHive = await hiveModel.getHiveByUser(String(targetUser.id), guildId);
              if (refreshedHive) viewHive = refreshedHive;
              modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => modules);
              milestones = await db.knex('hive_milestones').where({ hive_id: viewHive.id }).select('*').catch(() => milestones);
              resources = await userResources.getResources(userId);
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: '✅ Refreshed hive data.', client: interaction.client }) });
              return;
            }

            if (i.customId === HIVE_ACTION_UPGRADE_QUEEN_ID) {
              if (!canAct) {
                await i.reply({ content: 'Only the hive owner can run quick upgrades.', ephemeral: true });
                return;
              }
              const cost = 50;
              resources = await userResources.getResources(userId);
              if ((resources.royal_jelly || 0) < cost) {
                await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `❌ Not enough Royal Jelly. Need ${formatNumber(cost)}.`, client: interaction.client }) });
                return;
              }
              await userResources.modifyResources(userId, { royal_jelly: -cost });
              await hiveModel.updateHiveById(viewHive.id, { jelly_production_per_hour: (Number(viewHive.jelly_production_per_hour || 0) + 1) });
              viewHive = { ...viewHive, jelly_production_per_hour: Number(viewHive.jelly_production_per_hour || 0) + 1 };
              resources = await userResources.getResources(userId);
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `✅ Queen upgraded. +1 jelly/hour (spent ${formatNumber(cost)} RJ).`, client: interaction.client }) });
              return;
            }

            if (i.customId === HIVE_ACTION_UPGRADE_MODULE_ID) {
              if (!canAct) {
                await i.reply({ content: 'Only the hive owner can run quick upgrades.', ephemeral: true });
                return;
              }

              const modulesCfg = hiveDefaults.modules || {};
              let candidate = null;
              for (const moduleKey of Object.keys(modulesCfg)) {
                const cfg = modulesCfg[moduleKey];
                const moduleRow = modules.find(m => m.module_key === moduleKey);
                const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
                if (level >= Number(cfg.max_level || 0)) continue;
                const cost = Math.max(1, Math.floor(Number(cfg.base_cost_jelly || 1) * (level + 1)));
                if (!candidate || cost < candidate.cost) {
                  candidate = { moduleKey, cfg, level, row: moduleRow, cost };
                }
              }

              if (!candidate) {
                await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: '✅ All modules are already at max level.', client: interaction.client }) });
                return;
              }

              resources = await userResources.getResources(userId);
              if ((resources.royal_jelly || 0) < candidate.cost) {
                await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `❌ Not enough Royal Jelly for ${candidate.cfg.display}. Need ${formatNumber(candidate.cost)}.`, client: interaction.client }) });
                return;
              }

              await userResources.modifyResources(userId, { royal_jelly: -candidate.cost });
              if (candidate.row) {
                await db.knex('hive_modules').where({ id: candidate.row.id }).update({ level: candidate.level + 1, updated_at: db.knex.fn.now() });
              } else {
                await db.knex('hive_modules').insert({ hive_id: viewHive.id, module_key: candidate.moduleKey, level: 1 });
              }
              modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => modules);
              resources = await userResources.getResources(userId);
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `✅ Upgraded ${candidate.cfg.display} to level ${candidate.level + 1}.`, client: interaction.client }) });
              return;
            }

            if (i.customId === 'hive-nav-stats') currentScreen = 'stats';
            else if (i.customId === 'hive-nav-modules') currentScreen = 'modules';
            else if (i.customId === 'hive-nav-milestones') currentScreen = 'milestones';
            else if (i.customId === 'hive-nav-queen') currentScreen = 'queen';
            else if (i.customId === 'hive-nav-types') currentScreen = 'types';

            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false, canAct, client: interaction.client }) });
          } catch (err) {
            try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hive' }); } catch (_) {}
          }
        });

        collector.on('end', () => {
          try { msg.edit({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: true, canAct, client: interaction.client }) }).catch(() => {}); } catch (_) {}
        });
        return;
      }

      if (sub === 'type-info') {
        let viewHive = hive;
        let modules = [];
        let milestones = [];
        try {
          modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => []);
          milestones = await db.knex('hive_milestones').where({ hive_id: viewHive.id }).select('*').catch(() => []);
        } catch (e) {
          // Silently fail on database errors for optional tables
        }
        let resources = await userResources.getResources(userId);
        const canAct = true;

        await safeReply(interaction, {
          components: buildHiveScreen({ screen: 'types', hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, client: interaction.client }),
          flags: MessageFlags.IsComponentsV2,
          ephemeral: true
        }, { loggerName: 'command:hive' });

        let msg = null;
        try { msg = await interaction.fetchReply(); } catch (_) {}
        if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

        let currentScreen = 'types';

        const collector = msg.createMessageComponentCollector({
          filter: i => i.user.id === userId,
          time: 300_000
        });

        collector.on('collect', async i => {
          try {
            if (i.customId === HIVE_ACTION_REFRESH_ID) {
              const refreshedHive = await hiveModel.getHiveByUser(userId, guildId);
              if (refreshedHive) viewHive = refreshedHive;
              modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => modules);
              milestones = await db.knex('hive_milestones').where({ hive_id: viewHive.id }).select('*').catch(() => milestones);
              resources = await userResources.getResources(userId);
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: '✅ Refreshed hive data.', client: interaction.client }) });
              return;
            }

            if (i.customId === HIVE_ACTION_UPGRADE_QUEEN_ID) {
              const cost = 50;
              resources = await userResources.getResources(userId);
              if ((resources.royal_jelly || 0) < cost) {
                await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `❌ Not enough Royal Jelly. Need ${formatNumber(cost)}.`, client: interaction.client }) });
                return;
              }
              await userResources.modifyResources(userId, { royal_jelly: -cost });
              await hiveModel.updateHiveById(viewHive.id, { jelly_production_per_hour: (Number(viewHive.jelly_production_per_hour || 0) + 1) });
              viewHive = { ...viewHive, jelly_production_per_hour: Number(viewHive.jelly_production_per_hour || 0) + 1 };
              resources = await userResources.getResources(userId);
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `✅ Queen upgraded. +1 jelly/hour (spent ${formatNumber(cost)} RJ).`, client: interaction.client }) });
              return;
            }

            if (i.customId === HIVE_ACTION_UPGRADE_MODULE_ID) {
              const modulesCfg = hiveDefaults.modules || {};
              let candidate = null;
              for (const moduleKey of Object.keys(modulesCfg)) {
                const cfg = modulesCfg[moduleKey];
                const moduleRow = modules.find(m => m.module_key === moduleKey);
                const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
                if (level >= Number(cfg.max_level || 0)) continue;
                const cost = Math.max(1, Math.floor(Number(cfg.base_cost_jelly || 1) * (level + 1)));
                if (!candidate || cost < candidate.cost) {
                  candidate = { moduleKey, cfg, level, row: moduleRow, cost };
                }
              }

              if (!candidate) {
                await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: '✅ All modules are already at max level.', client: interaction.client }) });
                return;
              }

              resources = await userResources.getResources(userId);
              if ((resources.royal_jelly || 0) < candidate.cost) {
                await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `❌ Not enough Royal Jelly for ${candidate.cfg.display}. Need ${formatNumber(candidate.cost)}.`, client: interaction.client }) });
                return;
              }

              await userResources.modifyResources(userId, { royal_jelly: -candidate.cost });
              if (candidate.row) {
                await db.knex('hive_modules').where({ id: candidate.row.id }).update({ level: candidate.level + 1, updated_at: db.knex.fn.now() });
              } else {
                await db.knex('hive_modules').insert({ hive_id: viewHive.id, module_key: candidate.moduleKey, level: 1 });
              }
              modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => modules);
              resources = await userResources.getResources(userId);
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, notice: `✅ Upgraded ${candidate.cfg.display} to level ${candidate.level + 1}.`, client: interaction.client }) });
              return;
            }

            if (i.customId === 'hive-nav-stats') currentScreen = 'stats';
            else if (i.customId === 'hive-nav-modules') currentScreen = 'modules';
            else if (i.customId === 'hive-nav-milestones') currentScreen = 'milestones';
            else if (i.customId === 'hive-nav-queen') currentScreen = 'queen';
            else if (i.customId === 'hive-nav-types') currentScreen = 'types';

            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false, canAct, client: interaction.client }) });
          } catch (err) {
            try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hive' }); } catch (_) {}
          }
        });

        collector.on('end', () => {
          try { msg.edit({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: true, canAct, client: interaction.client }) }).catch(() => {}); } catch (_) {}
        });
        return;
      }

      // UPGRADE MODULE
      if (sub === 'upgrade-module') {
        const moduleKey = interaction.options.getString('module');
        const cfg = (hiveDefaults.modules || {})[moduleKey];
        if (!cfg) return safeReply(interaction, { content: `Unknown module: ${moduleKey}`, ephemeral: true });
        
        let existing = null;
        try {
          existing = await db.knex('hive_modules').where({ hive_id: hive.id, module_key: moduleKey }).first().catch(() => null);
        } catch (e) {
          return safeReply(interaction, { content: `Database error. Please try again later.`, ephemeral: true });
        }
        
        const currentLevel = existing ? Number(existing.level || 0) : cfg.default_level || 0;
        if (currentLevel >= cfg.max_level) return safeReply(interaction, { content: `${cfg.display} is already at max level.`, ephemeral: true });
        const cost = Math.max(1, Math.floor(cfg.base_cost_jelly * (currentLevel + 1)));
        const resources = await userResources.getResources(userId);
        if ((resources.royal_jelly || 0) < cost) return safeReply(interaction, { content: `Not enough Royal Jelly. Need ${cost}.`, ephemeral: true });
        
        try {
          await userResources.modifyResources(userId, { royal_jelly: -cost });
          if (existing) {
            await db.knex('hive_modules').where({ id: existing.id }).update({ level: currentLevel + 1, updated_at: db.knex.fn.now() });
          } else {
            await db.knex('hive_modules').insert({ hive_id: hive.id, module_key: moduleKey, level: 1 });
          }
        } catch (e) {
          return safeReply(interaction, { content: `Database error. Please try again later.`, ephemeral: true });
        }
        
        return safeReply(interaction, { content: `✅ Upgraded ${cfg.display} to level ${currentLevel + 1}. Spent ${formatNumber(cost)} Royal Jelly.`, ephemeral: true });
      }

      // UPGRADE QUEEN
      if (sub === 'upgrade-queen') {
        const cost = 50;
        const resources = await userResources.getResources(userId);
        if ((resources.royal_jelly || 0) < cost) return safeReply(interaction, { content: `Not enough Royal Jelly. Need ${cost}.`, ephemeral: true });
        await userResources.modifyResources(userId, { royal_jelly: -cost });
        await hiveModel.updateHiveById(hive.id, { jelly_production_per_hour: (Number(hive.jelly_production_per_hour || 0) + 1) });
        return safeReply(interaction, { content: `✅ Upgraded Queen Chamber. +1 jelly/hour. Spent ${cost} Royal Jelly.`, ephemeral: true });
      }

      // DELETE
      if (sub === 'delete') {
        await safeReply(interaction, {
          ...buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'confirm', includeFlags: true, client: interaction.client }),
          ephemeral: true
        }, { loggerName: 'command:hive' });

        let msg = null;
        try { msg = await interaction.fetchReply(); } catch (_) {}
        if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

        const collector = msg.createMessageComponentCollector({
          filter: i => i && (i.customId === HIVE_DELETE_CONFIRM_ID || i.customId === HIVE_DELETE_CANCEL_ID),
          time: 60_000
        });

        let handled = false;
        collector.on('collect', async i => {
          try {
            if (i.user.id !== userId) {
              await safeReply(i, { content: 'Only the command invoker can confirm deletion.', ephemeral: true }, { loggerName: 'command:hive' });
              return;
            }
            if (i.customId === HIVE_DELETE_CANCEL_ID) {
              handled = true;
              await i.update(buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'cancelled', includeFlags: false, client: interaction.client }));
              collector.stop('cancelled');
              return;
            }
            if (i.customId === HIVE_DELETE_CONFIRM_ID) {
              handled = true;
              await hiveModel.deleteHiveById(hive.id);
              await i.update(buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'deleted', includeFlags: false, client: interaction.client }));
              collector.stop('deleted');
              return;
            }
          } catch (err) {
            try { await safeReply(i, { content: `Error handling confirmation: ${err && err.message}`, ephemeral: true }, { loggerName: 'command:hive' }); } catch (_) {}
          }
        });

        collector.on('end', async (_collected, reason) => {
          if (!handled && reason === 'time') {
            try { msg.edit(buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'timed_out', includeFlags: false, client: interaction.client })).catch(() => {}); } catch (_) {}
          }
        });
        return;
      }
    } catch (e) {
      return safeReply(interaction, { content: `Error: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:hive' });
    }
  },

  async autocomplete(interaction) {
    try {
      const autocomplete = require('../../utils/autocomplete');
      const types = Object.values((hiveTypes && hiveTypes.types) || {});
      return autocomplete(interaction, types, { map: t => ({ name: `${t.name} — ${t.id}`, value: t.id }), max: 25 });
    } catch (e) {
      try { await interaction.respond([]); } catch (_) {}
    }
  }
};
