const { ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { ActionRowBuilder, SecondaryButtonBuilder, PrimaryButtonBuilder, DangerButtonBuilder, StringSelectMenuBuilder } = require('@discordjs/builders');
const hiveModel = require('../../models/hive');
const xenomorphModel = require('../../models/xenomorph');
const userModel = require('../../models/user');
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
const HIVE_NAV_ASSIGN_QUEEN_ID = 'hive-nav-assign-queen';
const HIVE_NAV_ADD_XENOS_ID = 'hive-nav-add-xenos';
const HIVE_ASSIGN_QUEEN_SELECT_ID = 'hive-select-assign-queen';
const HIVE_ADD_XENOS_SELECT_ID = 'hive-select-add-xenos';
const HIVE_UPGRADE_MODULE_SELECT_ID = 'hive-select-upgrade-module';

function isEvolvedXeno(x) {
  const role = String(x?.role || '').toLowerCase();
  const stage = String(x?.stage || '').toLowerCase();
  return role !== 'egg' && stage !== 'egg';
}

function toXenoOption(x) {
  const role = x?.role || x?.stage || 'xeno';
  const label = `#${x.id} ${String(role)}`.slice(0, 100);
  const descriptor = [x?.pathway ? `Path: ${x.pathway}` : null, `Lv ${Number(x?.level || 1)}`].filter(Boolean).join(' • ');
  const description = descriptor.slice(0, 100);
  return { label, value: String(x.id), description };
}

function getAssignableQueenXenos(xenos, hiveId) {
  const hiveIdNum = Number(hiveId);
  return (Array.isArray(xenos) ? xenos : []).filter(x => {
    const role = String(x?.role || '').toLowerCase();
    if (role !== 'queen') return false;
    if (x.hive_id == null) return true;
    return Number(x.hive_id) === hiveIdNum;
  });
}

function getAddableXenos(xenos, hiveId) {
  const hiveIdNum = Number(hiveId);
  return (Array.isArray(xenos) ? xenos : []).filter(x => {
    if (!isEvolvedXeno(x)) return false;
    if (x.hive_id == null) return true;
    return Number(x.hive_id) !== hiveIdNum;
  });
}

function getUpgradableModules(modulesRows = []) {
  const modulesCfg = hiveDefaults.modules || {};
  const upgradable = [];
  
  for (const moduleKey of Object.keys(modulesCfg)) {
    const cfg = modulesCfg[moduleKey] || {};
    const moduleRow = Array.isArray(modulesRows) ? modulesRows.find(m => m.module_key === moduleKey) : null;
    const level = moduleRow ? Number(moduleRow.level || 0) : Number(cfg.default_level || 0);
    const maxLevel = Number(cfg.max_level || 0);
    
    if (maxLevel > 0 && level >= maxLevel) continue;
    
    const cost = Math.max(1, Math.floor(Number(cfg.base_cost_jelly || 1) * (level + 1)));
    upgradable.push({ moduleKey, cfg, level, row: moduleRow, cost });
  }
  
  return upgradable.sort((a, b) => a.cost - b.cost);
}

function buildNavigationRow({ screen, disabled = false }) {
  return new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder().setCustomId('hive-nav-stats').setLabel('Stats').setDisabled(screen === 'stats' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-modules').setLabel('Modules').setDisabled(screen === 'modules' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-milestones').setLabel('Milestones').setDisabled(screen === 'milestones' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-queen').setLabel('Queen').setDisabled(screen === 'queen' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-types').setLabel('Types').setDisabled(screen === 'types' || disabled)
  );
}

function buildManagementRow({ screen, disabled = false, canAct = true }) {
  return new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder()
      .setCustomId(HIVE_NAV_ASSIGN_QUEEN_ID)
      .setLabel('Assign Queen')
      .setDisabled(disabled || screen === 'assign-queen' || !canAct),
    new SecondaryButtonBuilder()
      .setCustomId(HIVE_NAV_ADD_XENOS_ID)
      .setLabel('Add Xenos')
      .setDisabled(disabled || screen === 'add-xenos' || !canAct)
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

function buildQuickActionsRow({ disabled = false, canAct = true, hasQueen = false, queenCost = 50, moduleCandidate = null }) {
  const moduleLabel = moduleCandidate ? `Quick Module (${moduleCandidate.cost} RJ)` : 'Quick Module (MAX)';

  return new ActionRowBuilder().addComponents(
    new PrimaryButtonBuilder()
      .setCustomId(HIVE_ACTION_UPGRADE_QUEEN_ID)
      .setLabel(`Queen +1 (${queenCost} RJ)`)
      .setDisabled(disabled || !canAct || !hasQueen),
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
    types: '## ℹ️ Hive Types',
    'assign-queen': '## 👑 Assign Hive Queen',
    'add-xenos': '## 🧬 Add Xenos to Hive'
  };

  addV2TitleWithBotThumbnail({ container, title: screenTitles[screen] || screenTitles.stats, client });
  if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(notice));

  const hiveType = hive.type || hive.hive_type || 'default';
  const hiveMembers = Array.isArray(rows.xenos)
    ? rows.xenos.filter(x => Number(x.hive_id) === Number(hive.id))
    : [];
  const hivePopulation = hiveMembers.length;
  const snapshotLines = [
    `**Owner:** <@${targetUser.id}>`,
    `**Type:** \`${hiveType}\``,
    `**Capacity:** ${hivePopulation}/${hive.capacity || 0}`,
    `**Jelly/hour:** ${hive.jelly_production_per_hour || 0}`,
    `**Queen:** ${hive.queen_xeno_id ? `#${hive.queen_xeno_id} 👑` : '⚠️ Unassigned'}`
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(snapshotLines.join('\n')));

  if (screen === 'stats') {
    const hiveMembers = Array.isArray(rows.xenos)
      ? rows.xenos.filter(x => Number(x.hive_id) === Number(hive.id))
      : [];
    const statLines = [
      `**Hive ID:** \`${hive.id || 'unknown'}\``,
      `**Created:** ${toDiscordTimestamp(hive.created_at, 'f')} (${toDiscordTimestamp(hive.created_at, 'R')})`,
      `**Last Updated:** ${toDiscordTimestamp(hive.updated_at, 'f')} (${toDiscordTimestamp(hive.updated_at, 'R')})`,
      ''
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statLines.join('\n')));
    
    if (hiveMembers.length > 0) {
      const roleBreakdown = {};
      hiveMembers.forEach(m => {
        const role = String(m.role || m.stage).toLowerCase();
        roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
      });
      const breakdown = Object.entries(roleBreakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([role, count]) => `• ${role}: ${count}`)
        .join('\n');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Member Breakdown:**\n${breakdown}`));
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Empty hive. Add xenomorphs to grow your colony._'));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Upgrade modules and queens to increase production._'));
  } else if (screen === 'modules') {
    const modulesCfg = hiveDefaults.modules || {};
    const moduleCount = Object.keys(modulesCfg).length;
    const upgradedCount = Object.keys(modulesCfg).filter(k => {
      const cfg = modulesCfg[k];
      const moduleRow = rows.modules ? rows.modules.find(r => r.module_key === k) : null;
      const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
      return level > (cfg.default_level || 0);
    }).length;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Progress:** ${upgradedCount}/${moduleCount} modules upgraded`));
    
    // Display each module with inline upgrade button
    const upgradable = getUpgradableModules(rows.modules || []);
    if (upgradable.length === 0) {
      // No upgradable modules - show all modules as text only
      for (const k of Object.keys(modulesCfg)) {
        const cfg = modulesCfg[k];
        const moduleRow = rows.modules ? rows.modules.find(r => r.module_key === k) : null;
        const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${cfg.display}** (${k})\nLevel ${level} — ${cfg.description}`));
      }
    } else {
      // Display upgradable modules with buttons, then show maxed modules
      for (const m of upgradable) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${m.cfg.display}** (${m.moduleKey})\nLevel ${m.level} — ${m.cfg.description}`));
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new PrimaryButtonBuilder()
              .setCustomId(`hive-upgrade-module-${m.moduleKey}`)
              .setLabel(`Upgrade (${formatNumber(m.cost)} RJ)`)
              .setDisabled(!canAct)
          )
        );
      }
      
      // Show maxed-out modules
      const maxedModules = Object.keys(modulesCfg).filter(k => !upgradable.some(u => u.moduleKey === k));
      if (maxedModules.length > 0) {
        const maxedText = maxedModules.map(k => {
          const cfg = modulesCfg[k];
          const moduleRow = rows.modules ? rows.modules.find(r => r.module_key === k) : null;
          const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
          return `**${cfg.display}** (${k})\nLevel ${level} — _max level_`;
        }).join('\n\n');
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`_Maxed Modules:_\n${maxedText}`));
      }
    }
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
    const hiveMembers = Array.isArray(rows.xenos)
      ? rows.xenos.filter(x => Number(x.hive_id) === Number(hive.id))
      : [];
    const currentQueen = hive.queen_xeno_id
      ? hiveMembers.find(x => Number(x.id) === Number(hive.queen_xeno_id))
      : null;
    
    const queenSection = currentQueen
      ? `**Queen:** #${currentQueen.id} (Pathway: ${currentQueen.pathway || 'unknown'}, Level ${currentQueen.level || 1})`
      : '**Queen:** ⚠️ No queen assigned';
    
    const queenLines = [
      queenSection,
      '',
      `**Jelly Production:** ${hive.jelly_production_per_hour || 0} RJ/hour`,
      `**Your Royal Jelly:** ${royalJelly}`,
      `**Hive Members:** ${hiveMembers.length}/${hive.capacity || 0}`,
      `**Status:** ${currentQueen ? '✅ Active' : '❌ Needs Queen'}`
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(queenLines.join('\n')));
    if (hiveMembers.length > 0) {
      const memberList = hiveMembers.map(m => `• #${m.id} ${String(m.role || m.stage).padEnd(12)} (Lv ${m.level || 1})`).join('\n');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Members:**\n${memberList}`));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Upgrade queen: higher level = faster jelly production._'));
  } else if (screen === 'types') {
    const currentType = hiveType;
    const typeLines = Object.values((hiveTypes && hiveTypes.types) || {})
      .map(t => `${t.id === currentType ? '⭐ ' : ''}**${t.name}** (\`${t.id}\`)\n${t.description}`)
      .join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(typeLines || 'No hive types found'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`_Current hive type: \`${currentType}\`_`));
  } else if (screen === 'assign-queen') {
    const assignable = getAssignableQueenXenos(rows.xenos || [], hive.id);
    const currentQueen = hive.queen_xeno_id ? `#${hive.queen_xeno_id}` : 'None';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Current Queen:** ${currentQueen}`));
    if (!canAct) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Only the hive owner can assign a queen.'));
    } else if (!assignable.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ No eligible queen xenomorphs found. You need at least one fully-evolved Queen to assign.'));
    } else {
      const list = assignable.map(q => `• #${q.id} — Pathway: ${q.pathway || 'unknown'}, Level ${q.level || 1}`).join('\n');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Available Queens (${assignable.length}):**\n${list}`));
    }
  } else if (screen === 'add-xenos') {
    const addable = getAddableXenos(rows.xenos || [], hive.id);
    if (!canAct) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Only the hive owner can add xenos to this hive.'));
    } else if (!addable.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('✅ Your hive is fully populated! All eligible xenos are already members.'));
    } else {
      const list = addable.slice(0, 15).map(x => `• #${x.id} ${String(x.role || x.stage).padEnd(12)} (Pathway: ${x.pathway || 'unknown'}, Lv ${x.level || 1})`).join('\n');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Available to Add (${addable.length} total):**\n${list}${addable.length > 15 ? `\n... and ${addable.length - 15} more` : ''}\n\n_Select xenomorphs to add them to your hive._`));
    }
  }

  if (!expired) {
    const moduleCandidate = getQuickModuleCandidate(rows.modules || []);
    const hasQueen = Boolean(hive.queen_xeno_id);
    container.addActionRowComponents(buildQuickActionsRow({ disabled: false, canAct, hasQueen, queenCost: 50, moduleCandidate }));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    container.addActionRowComponents(buildNavigationRow({ screen, disabled: false }));
    container.addActionRowComponents(buildManagementRow({ screen, disabled: false, canAct }));

    if (screen === 'assign-queen') {
      const assignable = getAssignableQueenXenos(rows.xenos || [], hive.id).slice(0, 25);
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(HIVE_ASSIGN_QUEEN_SELECT_ID)
            .setPlaceholder(assignable.length ? 'Select a xenomorph as queen' : 'No eligible xenomorphs')
            .setDisabled(!canAct || assignable.length === 0)
            .setMaxValues(1)
            .setMinValues(1)
            .addOptions(assignable.length ? assignable.map(toXenoOption) : [{ label: 'No eligible xenomorphs', value: 'none', description: 'Evolve or assign xenos first' }])
        )
      );
    }

    // Module buttons are now added inline with module text; skip separate button generation

    if (screen === 'add-xenos') {
      const addable = getAddableXenos(rows.xenos || [], hive.id).slice(0, 25);
      const maxValues = Math.max(1, Math.min(10, addable.length));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(HIVE_ADD_XENOS_SELECT_ID)
            .setPlaceholder(addable.length ? 'Select xenomorphs to add' : 'No xenos available to add')
            .setDisabled(!canAct || addable.length === 0)
            .setMinValues(1)
            .setMaxValues(maxValues)
            .addOptions(addable.length ? addable.map(toXenoOption) : [{ label: 'No xenomorphs available', value: 'none', description: 'All eligible xenos are already in this hive' }])
        )
      );
    }
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
    options: []
  },

  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    try {
      let hive = await hiveModel.getHiveByUser(userId, guildId);
      
      // Show no-hive prompt if user doesn't have one
      if (!hive) {
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

      // Open main hive dashboard
      let viewHive = hive;
      const targetUser = interaction.user;
      const canAct = true;
      
      let modules = [];
      let milestones = [];
      let xenos = [];
      try {
        modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => []);
        milestones = await db.knex('hive_milestones').where({ hive_id: viewHive.id }).select('*').catch(() => []);
        xenos = await xenomorphModel.getXenosByOwner(String(userId)).catch(() => []);
      } catch (e) {
        // Silently fail on database errors
      }
      const royalJelly = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
      let resources = { royal_jelly: royalJelly };

      await safeReply(interaction, {
        components: buildHiveScreen({ screen: 'stats', hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, client: interaction.client }),
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      }, { loggerName: 'command:hive' });

      let msg = null;
      try { msg = await interaction.fetchReply(); } catch (_) {}
      if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

      let currentScreen = 'stats';

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
            xenos = await xenomorphModel.getXenosByOwner(String(userId)).catch(() => xenos);
            let rjRefresh = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
            resources = { royal_jelly: rjRefresh };
            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: '✅ Refreshed hive data.', client: interaction.client }) });
            return;
          }

          if (i.customId === HIVE_ACTION_UPGRADE_QUEEN_ID) {
            const cost = 50;
            let rj = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
            if (rj < cost) {
              resources = { royal_jelly: rj };
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `❌ Not enough Royal Jelly. Need ${formatNumber(cost)}.`, client: interaction.client }) });
              return;
            }
            await userModel.modifyCurrencyForGuild(String(userId), guildId, 'royal_jelly', -cost);
            await hiveModel.updateHiveById(viewHive.id, { jelly_production_per_hour: (Number(viewHive.jelly_production_per_hour || 0) + 1) });
            viewHive = { ...viewHive, jelly_production_per_hour: Number(viewHive.jelly_production_per_hour || 0) + 1 };
            rj = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
            resources = { royal_jelly: rj };
            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `✅ Queen upgraded. +1 jelly/hour (spent ${formatNumber(cost)} RJ).`, client: interaction.client }) });
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
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: '✅ All modules are already at max level.', client: interaction.client }) });
              return;
            }

            let rj = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
            if (rj < candidate.cost) {
              resources = { royal_jelly: rj };
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `❌ Not enough Royal Jelly for ${candidate.cfg.display}. Need ${formatNumber(candidate.cost)}.`, client: interaction.client }) });
              return;
            }

            await userModel.modifyCurrencyForGuild(String(userId), guildId, 'royal_jelly', -candidate.cost);
            if (candidate.row) {
              await db.knex('hive_modules').where({ id: candidate.row.id }).update({ level: candidate.level + 1, updated_at: db.knex.fn.now() });
            } else {
              await db.knex('hive_modules').insert({ hive_id: viewHive.id, module_key: candidate.moduleKey, level: 1 });
            }
            modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => modules);
            let rjAfterModuleUpgrade = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
            resources = { royal_jelly: rjAfterModuleUpgrade };
            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `✅ Upgraded ${candidate.cfg.display} to level ${candidate.level + 1}.`, client: interaction.client }) });
            return;
          }

          if (i.customId.startsWith('hive-upgrade-module-')) {
            const moduleKey = i.customId.replace('hive-upgrade-module-', '');
            const upgradable = getUpgradableModules(modules || []);
            const moduleToUpgrade = upgradable.find(m => m.moduleKey === moduleKey);
            if (!moduleToUpgrade) {
              await i.reply({ content: 'That module is no longer upgradable.', ephemeral: true });
              return;
            }

            let rj = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
            if (rj < moduleToUpgrade.cost) {
              resources = { royal_jelly: rj };
              await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `❌ Not enough Royal Jelly for ${moduleToUpgrade.cfg.display}. Need ${formatNumber(moduleToUpgrade.cost)}.`, client: interaction.client }) });
              return;
            }

            await userModel.modifyCurrencyForGuild(String(userId), guildId, 'royal_jelly', -moduleToUpgrade.cost);
            if (moduleToUpgrade.row) {
              await db.knex('hive_modules').where({ id: moduleToUpgrade.row.id }).update({ level: moduleToUpgrade.level + 1, updated_at: db.knex.fn.now() });
            } else {
              await db.knex('hive_modules').insert({ hive_id: viewHive.id, module_key: moduleKey, level: 1 });
            }
            modules = await db.knex('hive_modules').where({ hive_id: viewHive.id }).select('*').catch(() => modules);
            let rjAfter = await userModel.getCurrencyForGuild(String(userId), guildId, 'royal_jelly');
            resources = { royal_jelly: rjAfter };
            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `✅ Upgraded ${moduleToUpgrade.cfg.display} to level ${moduleToUpgrade.level + 1}.`, client: interaction.client }) });
            return;
          }

          if (i.customId === HIVE_ASSIGN_QUEEN_SELECT_ID) {
            const queenId = Number(i.values && i.values[0]);
            const eligible = getAssignableQueenXenos(xenos || [], viewHive.id);
            if (!queenId || !eligible.some(x => Number(x.id) === queenId)) {
              await i.reply({ content: 'That xenomorph is no longer eligible to become queen.', ephemeral: true });
              return;
            }

            await hiveModel.updateHiveById(viewHive.id, { queen_xeno_id: queenId });
            const queen = eligible.find(x => Number(x.id) === queenId);
            if (queen && Number(queen.hive_id) !== Number(viewHive.id)) {
              await db.knex('xenomorphs')
                .where({ id: queenId, owner_id: String(userId) })
                .update({ hive_id: viewHive.id, updated_at: db.knex.fn.now() })
                .catch(async () => {
                  await db.knex('xenomorphs').where({ id: queenId, owner_id: String(userId) }).update({ hive_id: viewHive.id });
                });
            }

            viewHive = { ...viewHive, queen_xeno_id: queenId };
            xenos = await xenomorphModel.getXenosByOwner(String(userId)).catch(() => xenos);
            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `✅ Assigned xenomorph #${queenId} as hive queen.`, client: interaction.client }) });
            return;
          }

          if (i.customId === HIVE_ADD_XENOS_SELECT_ID) {
            const selectedIds = Array.from(new Set((i.values || []).map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0)));
            if (!selectedIds.length) {
              await i.reply({ content: 'Select at least one xenomorph to add.', ephemeral: true });
              return;
            }

            const eligibleIds = new Set(getAddableXenos(xenos || [], viewHive.id).map(x => Number(x.id)));
            const finalIds = selectedIds.filter(id => eligibleIds.has(id));
            if (!finalIds.length) {
              await i.reply({ content: 'Those xenomorphs are no longer eligible to add.', ephemeral: true });
              return;
            }

            const updatedCount = await db.knex('xenomorphs')
              .where({ owner_id: String(userId) })
              .whereIn('id', finalIds)
              .update({ hive_id: viewHive.id, updated_at: db.knex.fn.now() })
              .catch(async () => {
                return db.knex('xenomorphs')
                  .where({ owner_id: String(userId) })
                  .whereIn('id', finalIds)
                  .update({ hive_id: viewHive.id });
              });

            xenos = await xenomorphModel.getXenosByOwner(String(userId)).catch(() => xenos);
            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, notice: `✅ Added ${formatNumber(updatedCount || finalIds.length)} xenomorph(s) to this hive.`, client: interaction.client }) });
            return;
          }

          if (i.customId === 'hive-nav-stats') currentScreen = 'stats';
          else if (i.customId === 'hive-nav-modules') currentScreen = 'modules';
          else if (i.customId === 'hive-nav-milestones') currentScreen = 'milestones';
          else if (i.customId === 'hive-nav-queen') currentScreen = 'queen';
          else if (i.customId === 'hive-nav-types') currentScreen = 'types';
          else if (i.customId === HIVE_NAV_ASSIGN_QUEEN_ID) currentScreen = 'assign-queen';
          else if (i.customId === HIVE_NAV_ADD_XENOS_ID) currentScreen = 'add-xenos';
          else if (i.customId === HIVE_DELETE_CONFIRM_ID) {
            await hiveModel.deleteHiveById(viewHive.id);
            await i.update(buildHiveDeleteV2Payload({ hiveName: viewHive.name || 'your hive', hiveId: viewHive.id, state: 'deleted', includeFlags: false, client: interaction.client }));
            collector.stop('deleted');
            return;
          }
          else if (i.customId === HIVE_DELETE_CANCEL_ID) {
            await i.update(buildHiveDeleteV2Payload({ hiveName: viewHive.name || 'your hive', hiveId: viewHive.id, state: 'cancelled', includeFlags: false, client: interaction.client }));
            collector.stop('cancelled');
            return;
          }

          await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: false, canAct, client: interaction.client }) });
        } catch (err) {
          try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hive' }); } catch (_) {}
        }
      });

      collector.on('end', () => {
        try { msg.edit({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources, xenos }, expired: true, canAct, client: interaction.client }) }).catch(() => {}); } catch (_) {}
      });
      return;
    } catch (e) {
      return safeReply(interaction, { content: `Error: ${e && (e.message || e)}`, ephemeral: true }, { loggerName: 'command:hive' });
    }
  },

  async autocomplete(interaction) {
    // No autocomplete needed for unified command
    try { await interaction.respond([]); } catch (_) {}
  }
};
