const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { ActionRowBuilder, SecondaryButtonBuilder, PrimaryButtonBuilder, DangerButtonBuilder } = require('@discordjs/builders');
const hiveModel = require('../../models/hive');
const xenomorphModel = require('../../models/xenomorph');
const userResources = require('../../models/userResources');
const { getCommandConfig } = require('../../utils/commandsConfig');
const { buildStatsV2Payload } = require('../../utils/componentsV2');
const hiveTypes = require('../../../config/hiveTypes.json');
const hiveDefaults = require('../../../config/hiveDefaults.json');
const db = require('../../db');

const cmd = getCommandConfig('hive') || { name: 'hive', description: 'Manage your hive' };

const HIVE_DELETE_CONFIRM_ID = 'hive-delete-confirm';
const HIVE_DELETE_CANCEL_ID = 'hive-delete-cancel';

function buildNavigationRow({ screen, disabled = false }) {
  return new ActionRowBuilder().addComponents(
    new SecondaryButtonBuilder().setCustomId('hive-nav-stats').setLabel('📊 Stats').setDisabled(screen === 'stats' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-modules').setLabel('🔧 Modules').setDisabled(screen === 'modules' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-milestones').setLabel('🎯 Milestones').setDisabled(screen === 'milestones' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-queen').setLabel('👑 Queen').setDisabled(screen === 'queen' || disabled),
    new SecondaryButtonBuilder().setCustomId('hive-nav-types').setLabel('ℹ️ Types').setDisabled(screen === 'types' || disabled)
  );
}

function buildHiveScreen({ screen = 'stats', hive, targetUser, userId, rows = {}, expired = false }) {
  const container = new ContainerBuilder();
  
  const screenTitles = {
    stats: '## 📊 Hive Stats',
    modules: '## 🔧 Hive Modules',
    milestones: '## 🎯 Hive Milestones',
    queen: '## 👑 Queen Status',
    types: '## ℹ️ Hive Types'
  };

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(screenTitles[screen] || screenTitles.stats));

  if (screen === 'stats') {
    const statLines = [
      `**Owner:** <@${targetUser.id}>`,
      `**Type:** \`${hive.type || hive.hive_type || 'default'}\``,
      `**Capacity:** ${hive.capacity || 0}`,
      `**Jelly/hour:** ${hive.jelly_production_per_hour || 0}`,
      `**Queen Xeno:** ${hive.queen_xeno_id || 'None'}`
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statLines.join('\n')));
  } else if (screen === 'modules') {
    const modulesCfg = hiveDefaults.modules || {};
    const moduleLines = Object.keys(modulesCfg).map(k => {
      const cfg = modulesCfg[k];
      const moduleRow = rows.modules ? rows.modules.find(r => r.module_key === k) : null;
      const level = moduleRow ? Number(moduleRow.level || 0) : (cfg.default_level || 0);
      return `**${cfg.display}** (${k})\nLevel ${level} — ${cfg.description}`;
    }).join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(moduleLines || 'No modules found'));
  } else if (screen === 'milestones') {
    const milestonesCfg = hiveDefaults.milestones || {};
    const milestoneLines = Object.keys(milestonesCfg).map(k => {
      const cfg = milestonesCfg[k];
      const done = rows.milestones ? rows.milestones.some(r => r.milestone_key === k && r.achieved) : false;
      return `${done ? '✅' : '❌'} **${cfg.name || k}** — ${cfg.description || ''}`;
    }).join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(milestoneLines || 'No milestones found'));
  } else if (screen === 'queen') {
    const queenLines = [
      `**Queen Xeno ID:** ${hive.queen_xeno_id || 'None'}`,
      `**Jelly/hour:** ${hive.jelly_production_per_hour || 0}`,
      `**Royal Jelly (you):** ${rows.resources?.royal_jelly || 0}`
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(queenLines.join('\n')));
  } else if (screen === 'types') {
    const typeLines = Object.values((hiveTypes && hiveTypes.types) || {})
      .map(t => `**${t.name}** (\`${t.id}\`)\n${t.description}`)
      .join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(typeLines || 'No hive types found'));
  }

  if (!expired) {
    container.addActionRowComponents(buildNavigationRow({ screen, disabled: false }));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Hive view expired_'));
  }

  return [container];
}

function buildNoHiveV2Payload({ includeFlags = true }) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## No Hive Found'),
    new TextDisplayBuilder().setContent('You don\'t have a hive yet. Create one to unlock hive features like modules, milestones, and queen upgrades.')
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new PrimaryButtonBuilder()
        .setLabel('🏗️ Create Hive')
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

function buildHiveDeleteV2Payload({ hiveName, hiveId, state = 'confirm', includeFlags = true }) {
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
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(titleMap[state] || titleMap.confirm),
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
    options: [
      { type: 1, name: 'create', description: 'Create your personal hive' },
      { type: 1, name: 'stats', description: 'Show your hive stats', options: [ { type: 6, name: 'user', description: 'View stats for this user (optional)', required: false } ] },
      { type: 1, name: 'modules', description: 'View hive modules' },
      { type: 1, name: 'upgrade-module', description: 'Upgrade a hive module', options: [ { type: 3, name: 'module', description: 'Module key to upgrade', required: true } ] },
      { type: 1, name: 'milestones', description: 'View milestones and progress' },
      { type: 1, name: 'queen-status', description: 'View queen and jelly production' },
      { type: 1, name: 'upgrade-queen', description: 'Upgrade the queen chamber (increase jelly output)' },
        { type: 1, name: 'type-info', description: 'Show hive type info', options: [ { type: 3, name: 'type', description: 'Which type', required: false, autocomplete: true } ] },
        { type: 1, name: 'delete', description: 'Delete your hive (irreversible)'
        }
    ]
  },

  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const userId = interaction.user.id;

    // CREATE
    if (sub === 'create') {
      try {
        let xenos = [];
        try { xenos = await xenomorphModel.getXenosByOwner(userId); } catch (e) { xenos = []; }
        const hasEvolved = Array.isArray(xenos) && xenos.some(x => (x.role && x.role !== 'egg') || (x.stage && x.stage !== 'egg'));
        if (!hasEvolved) return safeReply(interaction, { content: 'You need at least one xenomorph evolved beyond the egg stage to create a hive. Use `/hunt` to find hosts and `/evolve` to progress your xenomorphs.', ephemeral: true });

        const existing = await hiveModel.getHiveByUser(userId);
        if (existing) return safeReply(interaction, { content: 'You already have a hive.', ephemeral: true });
        const hive = await hiveModel.createHiveForUser(userId, { type: 'default', name: `${interaction.user.username}'s Hive` });
        return safeReply(interaction, { content: `✅ Hive created (ID: ${hive.id}).`, ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed creating hive: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    try {
      const hive = await hiveModel.getHiveByUser(userId);
      
      // Commands that require a hive
      const requiresHive = ['modules', 'upgrade-module', 'milestones', 'queen-status', 'upgrade-queen', 'type-info', 'delete'];
      if (!hive && requiresHive.includes(sub)) {
        await safeReply(interaction, {
          ...buildNoHiveV2Payload({ includeFlags: true }),
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
                  new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                )
              );
              await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
              return;
            }

            const existing = await hiveModel.getHiveByUser(userId);
            if (existing) {
              const container = new ContainerBuilder();
              container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Hive Already Exists'),
                new TextDisplayBuilder().setContent('✅ You already have a hive.')
              );
              container.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                )
              );
              await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
              return;
            }

            const newHive = await hiveModel.createHiveForUser(userId, { type: 'default', name: `${interaction.user.username}'s Hive` });
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent('## Hive Created'),
              new TextDisplayBuilder().setContent(`✅ Hive created (ID: ${newHive.id}).`)
            );
            container.addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
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
                new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
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
        const viewHive = (sub === 'stats') ? await hiveModel.getHiveByUser(String(targetUser.id)) : hive;
        
        if (!viewHive) {
          if (targetUser.id === userId) {
            await safeReply(interaction, {
              ...buildNoHiveV2Payload({ includeFlags: true }),
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
                      new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                    )
                  );
                  await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                const existing = await hiveModel.getHiveByUser(userId);
                if (existing) {
                  const container = new ContainerBuilder();
                  container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Hive Already Exists'),
                    new TextDisplayBuilder().setContent('✅ You already have a hive.')
                  );
                  container.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
                    )
                  );
                  await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                  return;
                }

                const newHive = await hiveModel.createHiveForUser(userId, { type: 'default', name: `${interaction.user.username}'s Hive` });
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                  new TextDisplayBuilder().setContent('## Hive Created'),
                  new TextDisplayBuilder().setContent(`✅ Hive created (ID: ${newHive.id}).`)
                );
                container.addActionRowComponents(
                  new ActionRowBuilder().addComponents(
                    new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
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
                    new PrimaryButtonBuilder().setLabel('🏗️ Create Hive').setCustomId('hive-create-prompt').setDisabled(true)
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
        const resources = await userResources.getResources(userId);

        await safeReply(interaction, {
          components: buildHiveScreen({ screen: initialScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false }),
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
            if (i.customId === 'hive-nav-stats') currentScreen = 'stats';
            else if (i.customId === 'hive-nav-modules') currentScreen = 'modules';
            else if (i.customId === 'hive-nav-milestones') currentScreen = 'milestones';
            else if (i.customId === 'hive-nav-queen') currentScreen = 'queen';
            else if (i.customId === 'hive-nav-types') currentScreen = 'types';

            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: false }) });
          } catch (err) {
            try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hive' }); } catch (_) {}
          }
        });

        collector.on('end', () => {
          try { msg.edit({ components: buildHiveScreen({ screen: currentScreen, hive: viewHive, targetUser, userId, rows: { modules, milestones, resources }, expired: true }) }).catch(() => {}); } catch (_) {}
        });
        return;
      }

      if (sub === 'type-info') {
        let modules = [];
        let milestones = [];
        try {
          modules = await db.knex('hive_modules').where({ hive_id: hive.id }).select('*').catch(() => []);
          milestones = await db.knex('hive_milestones').where({ hive_id: hive.id }).select('*').catch(() => []);
        } catch (e) {
          // Silently fail on database errors for optional tables
        }
        const resources = await userResources.getResources(userId);

        await safeReply(interaction, {
          components: buildHiveScreen({ screen: 'types', hive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false }),
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
            if (i.customId === 'hive-nav-stats') currentScreen = 'stats';
            else if (i.customId === 'hive-nav-modules') currentScreen = 'modules';
            else if (i.customId === 'hive-nav-milestones') currentScreen = 'milestones';
            else if (i.customId === 'hive-nav-queen') currentScreen = 'queen';
            else if (i.customId === 'hive-nav-types') currentScreen = 'types';

            await i.update({ components: buildHiveScreen({ screen: currentScreen, hive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: false }) });
          } catch (err) {
            try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:hive' }); } catch (_) {}
          }
        });

        collector.on('end', () => {
          try { msg.edit({ components: buildHiveScreen({ screen: currentScreen, hive, targetUser: interaction.user, userId, rows: { modules, milestones, resources }, expired: true }) }).catch(() => {}); } catch (_) {}
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
        
        return safeReply(interaction, { content: `✅ Upgraded ${cfg.display} to level ${currentLevel + 1}. Spent ${cost} Royal Jelly.`, ephemeral: true });
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
          ...buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'confirm', includeFlags: true }),
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
              await i.update(buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'cancelled', includeFlags: false }));
              collector.stop('cancelled');
              return;
            }
            if (i.customId === HIVE_DELETE_CONFIRM_ID) {
              handled = true;
              await hiveModel.deleteHiveById(hive.id);
              await i.update(buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'deleted', includeFlags: false }));
              collector.stop('deleted');
              return;
            }
          } catch (err) {
            try { await safeReply(i, { content: `Error handling confirmation: ${err && err.message}`, ephemeral: true }, { loggerName: 'command:hive' }); } catch (_) {}
          }
        });

        collector.on('end', async (_collected, reason) => {
          if (!handled && reason === 'time') {
            try { msg.edit(buildHiveDeleteV2Payload({ hiveName: hive.name || 'your hive', hiveId: hive.id, state: 'timed_out', includeFlags: false })).catch(() => {}); } catch (_) {}
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
