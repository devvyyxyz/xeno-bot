// EmbedBuilder not used in this command
const { getCommandConfig } = require('../../utils/commandsConfig');
const userModel = require('../../models/user');
const hatchManager = require('../../hatchManager');
const eggTypes = require('../../../config/eggTypes.json');

const cmd = getCommandConfig('eggs') || { name: 'eggs', description: 'Manage your eggs' };

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
      {
        type: 1, // SUB_COMMAND
        name: 'sell',
        description: 'Sell an egg for royal jelly',
        options: [
          { type: 3, name: 'egg', description: 'Egg type id', required: true, autocomplete: true },
          { type: 4, name: 'amount', description: 'Amount to sell', required: false }
        ]
      },
      {
        type: 1, // SUB_COMMAND
        name: 'hatch',
        description: 'Start hatching an egg',
        options: [
          { type: 3, name: 'egg', description: 'Egg type id', required: true, autocomplete: true },
          { type: 4, name: 'amount', description: 'Amount to hatch', required: false }
        ]
      },
        {
          type: 1,
          name: 'list',
          description: 'List your hatches (in-progress and ready to collect)'
        },
        {
          type: 1,
          name: 'collect',
          description: 'Collect a finished hatch',
          options: [
            { type: 3, name: 'ready_hatch', description: 'Choose a ready hatch', required: true, autocomplete: true }
          ]
        }
    ]
  },
  async autocomplete(interaction) {
    try {
      const autocomplete = require('../../utils/autocomplete');
      // detect subcommand for targeted autocomplete
      let sub = null;
      try { sub = interaction.options && interaction.options.getSubcommand ? (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })() : null; } catch (e) { sub = null; }
      const discordId = interaction.user.id;
      const guildId = interaction.guildId;
      const logger = require('../../utils/logger').get('command:eggs');
      const u = await userModel.getUserByDiscordId(discordId);
      // If collecting, list ready hatches for this user in this guild
      if (sub === 'collect') {
        try {
          const rows = await hatchManager.listHatches(discordId, guildId);
          const now = Date.now();
          const ready = (rows || []).filter(r => !r.collected && (Number(r.finishes_at) || 0) <= now);
          if (!ready || ready.length === 0) {
            return autocomplete(interaction, [{ id: 'none', name: 'No ready hatches' }], { map: it => ({ name: it.name, value: it.id }), max: 25 });
          }
          const items = ready.slice(0, 25).map(r => {
            const meta = eggTypes.find(t => t.id === r.egg_type);
            const name = meta ? meta.name : r.egg_type;
            // value is hatch id but label shows egg name for clarity
            return { id: String(r.id), name: `${name} (#${r.id})` };
          });
          return autocomplete(interaction, items, { map: it => ({ name: it.name, value: it.id }), max: 25 });
        } catch (e) {
          logger.warn('Collect autocomplete failed', { error: e && (e.stack || e) });
          return autocomplete(interaction, [], { map: it => ({ name: it.name, value: it.id }), max: 25 });
        }
      }
      let inventoryEggs = [];
      if (u && u.data && u.data.guilds && u.data.guilds[guildId] && u.data.guilds[guildId].eggs) {
        inventoryEggs = Object.entries(u.data.guilds[guildId].eggs).map(([id, qty]) => ({ id, qty: Number(qty) })).filter(e => e.qty > 0);
      }
      // If no eggs in inventory, fall back to listing all egg types (qty 0)
      if (!inventoryEggs || inventoryEggs.length === 0) {
        inventoryEggs = eggTypes.map(e => ({ id: e.id, qty: 0 }));
      }
      const items = inventoryEggs.map(e => {
        const meta = eggTypes.find(t => t.id === e.id);
        return { id: e.id, name: meta ? `${meta.name} (${e.qty})` : `${e.id} (${e.qty})` };
      });
      logger.info('Autocomplete invocation', { discordId, guildId, inventoryCount: inventoryEggs.length, itemsCount: items.length, focused: interaction.options.getFocused?.() || '' });
      return autocomplete(interaction, items, { map: it => ({ name: it.name, value: it.id }), max: 25 });
    } catch (e) {
      const logger = require('../../utils/logger').get('command:eggs');
      logger.warn('Autocomplete failed', { error: e && (e.stack || e) });
      try { await interaction.respond([]); } catch (respErr) { logger.warn('Failed to respond empty autocomplete', { error: respErr && (respErr.stack || respErr) }); }
    }
  },

  async executeInteraction(interaction) {
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const subCfg = sub ? (getCommandConfig(`eggs ${sub}`) || getCommandConfig(`eggs.${sub}`)) : null;
    if (subCfg && subCfg.developerOnly) {
      const cfg = require('../../../config/config.json');
      const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
      if (!ownerId || interaction.user.id !== ownerId) {
        const safeReply = require('../../utils/safeReply');
        await safeReply(interaction, { content: 'Only the bot developer/owner can run this subcommand.', ephemeral: true }, { loggerName: 'command:eggs' });
        return;
      }
    }
    const guildId = interaction.guildId;
    const discordId = interaction.user.id;
    try {
        if (sub === 'list') {
            await interaction.deferReply({ ephemeral: true });
            const rows = await hatchManager.listHatches(discordId, guildId);
            const safeReply = require('../../utils/safeReply');
            if (!rows || rows.length === 0) {
              await safeReply(interaction, { content: 'You have no hatches.', ephemeral: true }, { loggerName: 'command:eggs' });
              return;
            }
            const { EmbedBuilder } = require('discord.js');
            const now = Date.now();
            const embed = new EmbedBuilder().setTitle('Your Hatches').setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d).setTimestamp();
            // Build description lines with relative timestamps for pending hatches
            const lines = rows.map(r => {
              const finishes = Number(r.finishes_at) || 0;
              const ready = finishes <= now;
              const eggMeta = eggTypes.find(e => e.id === r.egg_type);
              const name = eggMeta ? eggMeta.name : r.egg_type;
              let status;
              if (r.collected) {
                status = 'Collected';
              } else if (ready) {
                status = 'Ready';
              } else {
                // Discord relative timestamp: <t:UNIX:R>
                status = `<t:${Math.floor(finishes / 1000)}:R>`;
              }
              return `#${r.id} — **${name}** — ${status}`;
            });
            // Truncate if too long
            let desc = lines.join('\n');
            if (desc.length > 3500) desc = desc.slice(0, 3496) + '...';
            embed.setDescription(desc);
            await safeReply(interaction, { embeds: [embed], ephemeral: true }, { loggerName: 'command:eggs' });
            return;
          }

        if (sub === 'collect') {
          await interaction.deferReply({ ephemeral: true });
          const idStr = interaction.options.getString('ready_hatch');
          const id = Number.parseInt(idStr, 10);
          if (!id || Number.isNaN(id)) {
            const safeReply = require('../../utils/safeReply');
            await safeReply(interaction, { content: 'Invalid hatch id selected.', ephemeral: true }, { loggerName: 'command:eggs' });
            return;
          }
          try {
            await hatchManager.collectHatch(discordId, guildId, id);
            const safeReply = require('../../utils/safeReply');
            await safeReply(interaction, { content: `Collected hatch #${id}. You received a facehugger.`, ephemeral: true }, { loggerName: 'command:eggs' });
          } catch (e) {
            const safeReply = require('../../utils/safeReply');
            await safeReply(interaction, { content: `Failed to collect hatch: ${e.message}`, ephemeral: true }, { loggerName: 'command:eggs' });
          }
          return;
        }

      if (sub === 'sell') {
        await interaction.deferReply({ ephemeral: true });
        const eggId = interaction.options.getString('egg');
        const amount = interaction.options.getInteger('amount') || 1;
        const eggConfig = eggTypes.find(e => e.id === eggId);
        if (!eggConfig) {
          const safeReply = require('../../utils/safeReply');
          await safeReply(interaction, { content: 'Unknown egg type.', ephemeral: true }, { loggerName: 'command:eggs' });
          return;
        }
        try {
          await userModel.removeEggsForGuild(discordId, guildId, eggId, amount);
          // compute sell price: prefer explicit `sell` field, otherwise default to half of configured price
          const sellPrice = Math.max(0, eggConfig.sell != null ? Number(eggConfig.sell) : Math.floor(Number(eggConfig.price || 0) / 2));
          const total = sellPrice * Number(amount);
          const newBal = await userModel.modifyCurrencyForGuild(discordId, guildId, 'royal_jelly', total);
          const safeReply = require('../../utils/safeReply');
          await safeReply(interaction, { content: `Sold ${amount} x ${eggConfig.name} for ${total} royal jelly. New balance: ${newBal}.`, ephemeral: true }, { loggerName: 'command:eggs' });
        } catch (e) {
          const safeReply = require('../../utils/safeReply');
          await safeReply(interaction, { content: `Failed to sell eggs: ${e.message}`, ephemeral: true }, { loggerName: 'command:eggs' });
        }
        return;
      }
      if (sub === 'hatch') {
        await interaction.deferReply({ ephemeral: true });
        const eggId = interaction.options.getString('egg');
        const amount = interaction.options.getInteger('amount') || 1;
        const eggConfig = eggTypes.find(e => e.id === eggId);
        if (!eggConfig) {
          const safeReply = require('../../utils/safeReply');
          await safeReply(interaction, { content: 'Unknown egg type.', ephemeral: true }, { loggerName: 'command:eggs' });
          return;
        }
        try {
          // Validate user has enough eggs
          const u = await userModel.getUserByDiscordId(discordId);
          const curQty = Number((u?.data?.guilds?.[guildId]?.eggs?.[eggId]) || 0);
          if (curQty < amount) {
            const safeReply = require('../../utils/safeReply');
            await safeReply(interaction, { content: `You only have ${curQty} x ${eggConfig.name}.`, ephemeral: true }, { loggerName: 'command:eggs' });
            return;
          }
          const hatchSeconds = Number(eggConfig.hatch || 60);
          const created = [];
          for (let i = 0; i < amount; i++) {
            // startHatch will decrement inventory per call
            const h = await hatchManager.startHatch(discordId, guildId, eggId, hatchSeconds * 1000);
            created.push(h.id);
          }
          const safeReply = require('../../utils/safeReply');
          await safeReply(interaction, { content: `Started ${created.length} hatch(es) for ${eggConfig.name}. First hatch id: ${created[0]}. Each will finish in ${hatchSeconds}s.`, ephemeral: true }, { loggerName: 'command:eggs' });
        } catch (e) {
          const safeReply = require('../../utils/safeReply');
          await safeReply(interaction, { content: `Failed to start hatch: ${e.message}`, ephemeral: true }, { loggerName: 'command:eggs' });
        }
        return;
      }
    } catch (err) {
      const logger = require('../../utils/logger').get('command:eggs');
      logger.error('Unhandled error in eggs command', { error: err && (err.stack || err) });
      try { const safeReply = require('../../utils/safeReply'); await safeReply(interaction, { content: `Error: ${err.message}`, ephemeral: true }, { loggerName: 'command:eggs' }); } catch (replyErr) { logger.warn('Failed to send error reply in eggs command', { error: replyErr && (replyErr.stack || replyErr) }); }
    }
  }
};
