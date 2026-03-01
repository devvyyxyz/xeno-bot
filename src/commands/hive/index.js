const { EmbedBuilder } = require('discord.js');
const hiveModel = require('../../models/hive');
const userModel = require('../../models/user');
const userResources = require('../../models/userResources');
const { getCommandConfig } = require('../../utils/commandsConfig');
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
      { type: 1, name: 'stats', description: 'Show your hive stats' },
      { type: 1, name: 'modules', description: 'View hive modules' },
      { type: 1, name: 'upgrade-module', description: 'Upgrade a hive module', options: [ { type: 3, name: 'module', description: 'Module key to upgrade', required: true } ] },
      { type: 1, name: 'milestones', description: 'View milestones and progress' },
      { type: 1, name: 'queen-status', description: 'View queen and jelly production' },
      { type: 1, name: 'upgrade-queen', description: 'Upgrade the queen chamber (increase jelly output)' },
      { type: 1, name: 'type-info', description: 'Show hive type info', options: [ { type: 3, name: 'type', description: 'Which type', required: false, autocomplete: true } ] }
    ]
  },

  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const userId = interaction.user.id;

    // CREATE
    if (sub === 'create') {
      try {
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
        const hive = await hiveModel.getHiveByUser(userId);
        if (!hive) return safeReply(interaction, { content: 'You do not have a hive yet. Create one with `/hive create`.', ephemeral: true });
        const embed = new EmbedBuilder()
          .setTitle(`${hive.name || 'Your Hive'}`)
          .addFields(
            { name: 'Owner', value: `<@${hive.owner_discord_id}>`, inline: true },
            { name: 'Type', value: String(hive.type || hive.hive_type || 'default'), inline: true },
            { name: 'Capacity', value: String(hive.capacity || 0), inline: true },
            { name: 'Jelly / hour', value: String(hive.jelly_production_per_hour || 0), inline: true },
            { name: 'Queen Xeno', value: String(hive.queen_xeno_id || 'None'), inline: true }
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
