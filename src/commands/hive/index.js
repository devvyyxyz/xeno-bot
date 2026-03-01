const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const hiveModel = require('../../models/hive');
const xenomorphModel = require('../../models/xenomorph');
const userModel = require('../../models/user');
const userResources = require('../../models/userResources');
const { getCommandConfig } = require('../../utils/commandsConfig');
const { buildStatsV2Payload } = require('../../utils/componentsV2');
const hiveTypes = require('../../../config/hiveTypes.json');
const hiveDefaults = require('../../../config/hiveDefaults.json');
const db = require('../../db');

const cmd = getCommandConfig('hive') || { name: 'hive', description: 'Manage your hive' };

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
        // Require the user to have at least one xenomorph evolved beyond egg stage
        let xenos = [];
        try { xenos = await xenomorphModel.getXenosByOwner(userId); } catch (e) { xenos = []; }
        const hasEvolved = Array.isArray(xenos) && xenos.some(x => (x.role && x.role !== 'egg') || (x.stage && x.stage !== 'egg'));
        if (!hasEvolved) return safeReply(interaction, { content: 'You need at least one xenomorph evolved beyond the egg stage to create a hive. Use `/hunt` to find hosts and `/evolve` to progress your xenomorphs.', ephemeral: true });

        const existing = await hiveModel.getHiveByUser(userId);
        if (existing) return safeReply(interaction, { content: 'You already have a hive.', ephemeral: true });
        const hive = await hiveModel.createHiveForUser(userId, { type: 'default', name: `${interaction.user.username}'s Hive` });
        return safeReply(interaction, { content: `Hive created (ID: ${hive.id}).`, ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed creating hive: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // STATS
    if (sub === 'stats') {
      try {
        const logger = require('../../utils/logger').get('command:hive');
        const targetUser = (() => { try { return interaction.options.getUser('user'); } catch (e) { return null; } })() || interaction.user;
        const hive = await hiveModel.getHiveByUser(String(targetUser.id));
        if (!hive) return safeReply(interaction, { content: `${targetUser.id === interaction.user.id ? 'You do not have a hive yet. Create one with `/hive create`.' : `${targetUser.username} does not have a hive yet.`}`, ephemeral: true });

        const title = `${hive.name || `${targetUser.username}'s Hive`}`;
        const rows = [
          { label: 'Owner', value: `<@${targetUser.id}>` },
          { label: 'Type', value: String(hive.type || hive.hive_type || 'default') },
          { label: 'Capacity', value: String(hive.capacity || 0) },
          { label: 'Jelly / hour', value: String(hive.jelly_production_per_hour || 0) },
          { label: 'Queen Xeno', value: String(hive.queen_xeno_id || 'None') }
        ];

        try {
          return safeReply(interaction, {
            ...buildStatsV2Payload({
              title,
              rows,
              footer: `Requested by ${interaction.user.username}`
            }),
            ephemeral: true
          });
        } catch (v2Err) {
          logger.warn('Hive stats V2 payload failed; falling back to embed', { error: v2Err && (v2Err.stack || v2Err) });
        }

        const embed = new EmbedBuilder()
          .setTitle(title)
          .addFields(
            { name: 'Owner', value: rows[0].value, inline: true },
            { name: 'Type', value: rows[1].value, inline: true },
            { name: 'Capacity', value: rows[2].value, inline: true },
            { name: 'Jelly / hour', value: rows[3].value, inline: true },
            { name: 'Queen Xeno', value: rows[4].value, inline: true }
          )
          .setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed fetching hive stats: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // MODULES
    if (sub === 'modules') {
      try {
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive yet. Create one with `/hive create`.', ephemeral: true });
        const rows = await db.knex('hive_modules').where({ hive_id: hive.id }).select('*');
        const modulesCfg = hiveDefaults.modules || {};
        const lines = Object.keys(modulesCfg).map(k => {
          const cfg = modulesCfg[k];
          const row = rows.find(r => r.module_key === k) || null;
          const level = row ? Number(row.level || 0) : (cfg.default_level || 0);
          return `**${cfg.display}** (${k}) — Level ${level}: ${cfg.description}`;
        });
        const embed = new EmbedBuilder().setTitle('Hive Modules').setDescription(lines.join('\n\n')).setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed fetching modules: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // UPGRADE MODULE
    if (sub === 'upgrade-module') {
      try {
        const moduleKey = interaction.options.getString('module');
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive yet. Create one with `/hive create`.', ephemeral: true });
        const cfg = (hiveDefaults.modules || {})[moduleKey];
        if (!cfg) return safeReply(interaction, { content: `Unknown module: ${moduleKey}`, ephemeral: true });
        const existing = await db.knex('hive_modules').where({ hive_id: hive.id, module_key: moduleKey }).first();
        const currentLevel = existing ? Number(existing.level || 0) : cfg.default_level || 0;
        if (currentLevel >= cfg.max_level) return safeReply(interaction, { content: `${cfg.display} is already at max level.`, ephemeral: true });
        const cost = Math.max(1, Math.floor(cfg.base_cost_jelly * (currentLevel + 1)));
        const resources = await userResources.getResources(userId);
        if ((resources.royal_jelly || 0) < cost) return safeReply(interaction, { content: `Not enough Royal Jelly. Need ${cost}.`, ephemeral: true });
        await userResources.modifyResources(userId, { royal_jelly: -cost });
        if (existing) {
          await db.knex('hive_modules').where({ id: existing.id }).update({ level: currentLevel + 1, updated_at: db.knex.fn.now() });
        } else {
          await db.knex('hive_modules').insert({ hive_id: hive.id, module_key: moduleKey, level: 1 });
        }
        return safeReply(interaction, { content: `Upgraded ${cfg.display} to level ${currentLevel + 1}. Spent ${cost} Royal Jelly.`, ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed upgrading module: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // MILESTONES
    if (sub === 'milestones') {
      try {
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive yet. Create one with `/hive create`.', ephemeral: true });
        const rows = await db.knex('hive_milestones').where({ hive_id: hive.id }).select('*');
        const milestonesCfg = hiveDefaults.milestones || {};
        const lines = Object.keys(milestonesCfg).map(k => {
          const cfg = milestonesCfg[k];
          const done = rows.some(r => r.milestone_key === k && r.achieved);
          return `${done ? '✅' : '❌'} **${cfg.name || k}** — ${cfg.description || ''}`;
        });
        const embed = new EmbedBuilder().setTitle('Hive Milestones').setDescription(lines.join('\n\n')).setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed fetching milestones: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // QUEEN STATUS
    if (sub === 'queen-status') {
      try {
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive yet. Create one with `/hive create`.', ephemeral: true });
        const resources = await userResources.getResources(userId);
        const baseJelly = Number(hive.jelly_production_per_hour || 0);
        const embed = new EmbedBuilder()
          .setTitle(`${interaction.user.username}'s Queen Status`)
          .addFields(
            { name: 'Queen Xeno ID', value: String(hive.queen_xeno_id || 'None'), inline: true },
            { name: 'Jelly / hour', value: String(baseJelly), inline: true },
            { name: 'Royal Jelly (you)', value: String(resources.royal_jelly || 0), inline: true }
          )
          .setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed fetching queen status: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // UPGRADE QUEEN
    if (sub === 'upgrade-queen') {
      try {
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive yet. Create one with `/hive create`.', ephemeral: true });
        const cost = 50;
        const resources = await userResources.getResources(userId);
        if ((resources.royal_jelly || 0) < cost) return safeReply(interaction, { content: `Not enough Royal Jelly. Need ${cost}.`, ephemeral: true });
        await userResources.modifyResources(userId, { royal_jelly: -cost });
        await hiveModel.updateHiveById(hive.id, { jelly_production_per_hour: (Number(hive.jelly_production_per_hour || 0) + 1) });
        return safeReply(interaction, { content: `Upgraded Queen Chamber. +1 jelly/hour. Spent ${cost} Royal Jelly.`, ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed upgrading queen chamber: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // TYPE INFO
    if (sub === 'type-info') {
      try {
        const requested = interaction.options.getString('type') || null;
        if (requested) {
          const info = (hiveTypes && hiveTypes.types && hiveTypes.types[requested]) || null;
          if (!info) return safeReply(interaction, { content: `Unknown hive type: ${requested}.`, ephemeral: true });
          const bonusEntries = info.bonuses ? Object.entries(info.bonuses).map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`) : [];
          const embed = new EmbedBuilder()
            .setTitle(`${info.name} (${info.id})`)
            .setDescription(info.description || '')
            .addFields(
              { name: 'ID', value: String(info.id || requested), inline: true },
              { name: 'Requirement', value: String(info.requirement || 'None'), inline: true },
              { name: 'Bonuses', value: bonusEntries.length ? bonusEntries.join('\n') : 'None', inline: false }
            )
            .setTimestamp();
          return safeReply(interaction, { embeds: [embed], ephemeral: true });
        }
        // list available types
        const lines = Object.values((hiveTypes && hiveTypes.types) || {}).map(t => `**${t.name}** (${t.id}) — ${t.description}`);
        const embed = new EmbedBuilder().setTitle('Available Hive Types').setDescription(lines.join('\n\n')).setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Failed fetching hive type info: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    // DELETE
    if (sub === 'delete') {
      try {
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive to delete.', ephemeral: true });

        const embed = new EmbedBuilder()
          .setTitle('Confirm Hive Deletion')
          .setDescription(`This will permanently delete **${hive.name || 'your hive'}** (ID: ${hive.id}).\n\nAre you sure you want to proceed?`)
          .setTimestamp();

        const row = { type: 1, components: [
          { type: 2, style: 4, custom_id: 'hive-delete-confirm', label: 'Delete', disabled: false },
          { type: 2, style: 2, custom_id: 'hive-delete-cancel', label: 'Cancel', disabled: false }
        ] };

        const createInteractionCollector = require('../../utils/collectorHelper');
        // Send the ephemeral reply first so we have a message to attach the collector to
        let msg = null;
        try {
          msg = await interaction.reply({ embeds: [embed], components: [row], ephemeral: true, fetchReply: true });
        } catch (e) {
          // fallback to defer+edit path handled by collector helper
        }
        const { collector, message: _msg } = await createInteractionCollector(interaction, { embeds: [embed], components: [row], time: 60_000, ephemeral: true, edit: true, collectorOptions: { componentType: 2 } });
        if (!msg && _msg) msg = _msg;
        if (!collector) return safeReply(interaction, { content: 'Failed creating confirmation prompt.', ephemeral: true });

        let handled = false;
        collector.on('collect', async i => {
          try {
            if (i.user.id !== interaction.user.id) {
              await i.reply({ content: 'Only the command invoker can confirm deletion.', ephemeral: true });
              return;
            }
            if (i.customId === 'hive-delete-cancel') {
              handled = true;
              const disabledRow = { type: 1, components: [
                { type: 2, style: 4, custom_id: 'hive-delete-confirm', label: 'Delete', disabled: true },
                { type: 2, style: 2, custom_id: 'hive-delete-cancel', label: 'Cancel', disabled: true }
              ] };
              await i.update({ embeds: [new EmbedBuilder().setTitle('Deletion Cancelled').setDescription('Hive deletion has been cancelled.').setTimestamp()], components: [disabledRow] });
              collector.stop('cancelled');
              return;
            }
            if (i.customId === 'hive-delete-confirm') {
              handled = true;
              await hiveModel.deleteHiveById(hive.id);
              const disabledRow = { type: 1, components: [
                { type: 2, style: 4, custom_id: 'hive-delete-confirm', label: 'Delete', disabled: true },
                { type: 2, style: 2, custom_id: 'hive-delete-cancel', label: 'Cancel', disabled: true }
              ] };
              await i.update({ embeds: [new EmbedBuilder().setTitle('Hive Deleted').setDescription(`Deleted hive **${hive.name || 'your hive'}** (ID: ${hive.id}).`).setTimestamp()], components: [disabledRow] });
              collector.stop('deleted');
              return;
            }
          } catch (err) {
            try { await i.reply({ content: `Error handling confirmation: ${err && err.message}`, ephemeral: true }); } catch (_) {}
          }
        });

        collector.on('end', async (_collected, reason) => {
          if (!handled && reason === 'time') {
            try {
              const disabledRow = { type: 1, components: [
                { type: 2, style: 4, custom_id: 'hive-delete-confirm', label: 'Delete', disabled: true },
                { type: 2, style: 2, custom_id: 'hive-delete-cancel', label: 'Cancel', disabled: true }
              ] };
              await msg.edit({ embeds: [new EmbedBuilder().setTitle('Timed Out').setDescription('No response received. Hive deletion cancelled.').setTimestamp()], components: [disabledRow] });
            } catch (_) {}
          }
        });

        return;
      } catch (e) {
        return safeReply(interaction, { content: `Failed to delete hive: ${e && (e.message || e)}`, ephemeral: true });
      }
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
