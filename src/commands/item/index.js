const { EmbedBuilder } = require('discord.js');
const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const shopConfig = require('../../../config/shop.json');
let userModel = null;
let safeReply = null;
const itemsService = require('../../services/items');
// Local helper to resolve items (service or config fallback)
const findItem = (id) => {
  if (!id) return null;
  try {
    if (itemsService && typeof itemsService.findItem === 'function') return itemsService.findItem(id);
  } catch (_) { /* ignore */ }
  try {
    const shop = require('../../../config/shop.json');
    if (shop && Array.isArray(shop.items)) return shop.items.find(i => i.id === id || (i.name && String(i.name).toLowerCase() === String(id).toLowerCase())) || null;
  } catch (_) { /* ignore */ }
  return null;
};

const cmdCfg = getCommandConfig('item') || { name: 'item', description: 'Manage and use items' };

// use centralized items service for lookups and inventory operations

module.exports = {
  name: cmdCfg.name || 'item',
  description: cmdCfg.description || 'Use or inspect items',
  requiredPermissions: cmdCfg.requiredPermissions,
  hidden: cmdCfg.hidden === true,
  ephemeral: cmdCfg.ephemeral === true,
  data: {
    name: 'item',
    description: 'Item utilities',
    options: buildSubcommandOptions('item', [
      {type: 1, name: 'use', description: 'Use an item (placeholder)', options: [{type: 3, name: 'item_id', description: 'Item id', required: true}, {type: 3, name: 'target', description: 'Target id (optional)', required: false}]},
      {type: 1, name: 'info', description: 'Get item info (placeholder)', options: [{type: 3, name: 'item_id', description: 'Item id', required: true}]},
      {type: 1, name: 'combine', description: 'Combine two items (placeholder)', options: [{type: 3, name: 'item1', description: 'First item id', required: true}, {type: 3, name: 'item2', description: 'Second item id', required: true}]}
    ])
  },

  async executeInteraction(interaction) {
    // lazy-require models/utilities so tests can mock requires before invoking
    userModel = require('../../models/user');
    safeReply = require('../../utils/safeReply');
    const respond = (payload) => safeReply(interaction, payload, { loggerName: 'command:item' });
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    // Lazy-require models so tests can mock `require('../src/models/user')` after module load
    const subCfg = sub ? (getCommandConfig(`item ${sub}`) || getCommandConfig(`item.${sub}`)) : null;
    if (subCfg && subCfg.developerOnly) {
      const cfg = require('../../../config/config.json');
      const ownerId = (cfg && cfg.owner) ? String(cfg.owner) : null;
      if (!ownerId || interaction.user.id !== ownerId) {
        await safeReply(interaction, { content: 'Only the bot developer/owner can run this subcommand.', ephemeral: true }, { loggerName: 'command:item' });
        return;
      }
    }
    const guildId = interaction.guildId;
    const userId = String(interaction.user.id);
    if (sub === 'info') {
      const itemId = interaction.options.getString('item_id');
      const item = findItem(itemId);
      if (!item) return respond({ content: 'Item not found.', ephemeral: true });
      const embed = new EmbedBuilder().setTitle(item.name).setDescription(item.description || '').addFields({ name: 'Price', value: String(item.price || '—') }, { name: 'Rarity', value: String(item.rarity || 'common') }).setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d);
      return respond({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'use') {
      await interaction.deferReply({ ephemeral: true });
      const itemId = interaction.options.getString('item_id') || interaction.options.getString('item');
      const target = interaction.options.getString('target') || interaction.options.getString('target_id');
      const item = itemsService.findItem(itemId);
      if (!item) return respond({ content: 'Item not found.' });
      try {
        // consume the item via service which returns the actual inventory key used
        const consumed = await itemsService.consumeItemForUser(userId, guildId, item, 1);
        if (!consumed || !consumed.success) {
          return respond({ content: consumed && consumed.error ? `Failed to use item: ${consumed.error}` : `You don't have any ${item.name}.` });
        }
        const invKey = consumed.key;
        const userAfter = await userModel.getUserByDiscordId(userId);
        const data = (userAfter && userAfter.data) ? userAfter.data : ({});
        const targetUserId = (userAfter && userAfter.id) ? userAfter.id : userId;
        data.guilds = data.guilds || {};
        data.guilds[guildId] = data.guilds[guildId] || {};
        data.guilds[guildId].effects = data.guilds[guildId].effects || {};
        const now = Date.now();
        switch (item.id) {
          case 'incubation_accelerator': {
            // Choose a random multiplier between 0.25 and 0.5 (reduces hatch time to 25-50%)
            const randMul = Math.round(((Math.random() * (0.5 - 0.25)) + 0.25) * 100) / 100;
            data.guilds[guildId].effects.incubation_accelerator = { applied_at: now, multiplier: randMul, expires_at: now + 1000 * 60 * 60 };
            break;
          }
          case 'jelly_extractor':
            data.guilds[guildId].effects.jelly_extractor = { applied_at: now, multiplier: 2, expires_at: now + 1000 * 60 * 60 * 2 };
            break;
          case 'defensive_pheromones':
            data.guilds[guildId].effects.defensive_pheromones = { applied_at: now, expires_at: now + 1000 * 60 * 60 };
            break;
          case 'mutation_stabilizer':
            data.guilds[guildId].effects.mutation_stabilizer = { applied_at: now, uses: 3 };
            break;
          case 'golden_gen':
            data.guilds[guildId].effects.golden_next = { applied_at: now, expires_at: now + 1000 * 60 * 60 * 24 };
            break;
          case 'pathogen_spores':
            data.guilds[guildId].effects.pathogen_spores = { applied_at: now, uses: 1 };
            break;
          case 'pathogen_liquid':
            data.guilds[guildId].effects.pathogen_liquid = { applied_at: now, applied_by: userId };
            break;
          case 'pathogen': {
            // Pathogen reagent: must target a queen xenomorph in this guild
            // Target should be xenomorph id
            try {
              const xenoId = Number(target || 0);
              if (!xenoId) {
                throw new Error('You must specify a target xenomorph id to use this item.');
              }
              const xenoModel = require('../../models/xenomorph');
              const hiveModel = require('../../models/hive');
              const xeno = await xenoModel.getByIdScoped(xenoId, guildId);
              if (!xeno) throw new Error('Xenomorph not found in this guild.');
              // Prevent converting a xenomorph that's already on the pathogen pathway
              if (String(xeno.pathway || '').toLowerCase() === 'pathogen' || String(xeno.role || xeno.stage || '').toLowerCase().includes('pathogen')) {
                throw new Error('Target xenomorph is already a Pathogen; reagent cannot be applied.');
              }
              if (String(xeno.owner_id || xeno.owner) !== String(userId)) {
                throw new Error('You do not own that xenomorph.');
              }
              // Allow applying reagent to Queens OR Drones to start the pathogen pathway
              const hive = await hiveModel.getHiveByUser(userId, guildId).catch(() => null);
              const isHiveQueen = hive && Number(hive.queen_xeno_id) === Number(xeno.id);
              const roleStr = String(xeno.role || xeno.stage || '').toLowerCase();
              const isQueenRole = roleStr.includes('queen');
              const isDroneRole = roleStr === 'drone' || roleStr.includes('drone');

              if (!isHiveQueen && !isQueenRole && !isDroneRole) {
                throw new Error('Target xenomorph must be a Queen or a Drone to use this reagent.');
              }

              // Transform the xeno appropriately
              const newData = Object.assign({}, xeno.data || {}, { pathogen_transformed_at: now, pathogen_transformed_by: userId });
                if (isQueenRole || isHiveQueen) {
                // Queens become pathogen queens
                await xenoModel.updateXenoById(xeno.id, { pathway: 'pathogen', role: 'pathogen_queen', stage: 'pathogen_queen', data: newData });
                await userModel.updateUserDataRawById(targetUserId, data);
                const emojis = require('../../../config/emojis.json');
                const PATHOGEN_EMOJI = emojis.pathogen_queen;
                return respond({ content: `Used one ${item.name} on Queen ${PATHOGEN_EMOJI} #${xeno.id}. It has been transformed into a Pathogen Queen.` });
              } else {
                // Drones are switched to the pathogen pathway but retain their drone stage
                await xenoModel.updateXenoById(xeno.id, { pathway: 'pathogen', role: xeno.role || xeno.stage, stage: xeno.stage || xeno.role, data: newData });
                await userModel.updateUserDataRawById(targetUserId, data);
                return respond({ content: `Used one ${item.name} on Drone #${xeno.id}. It has been moved to the Pathogen pathway.` });
              }
              } catch (err) {
              // restore item if failed (use the inventory key we consumed if available)
              try { await itemsService.restoreItemForUser(userId, guildId, invKey || item.id, 1); } catch (_) { /* ignore */ }
              return respond({ content: `Failed to apply ${item.name}: ${err && err.message ? err.message : err}` });
            }
          }
          case 'cyborg_parts':
            data.guilds[guildId].effects.cyborg_parts = { applied_at: now, uses: 1 };
            break;
          default:
            break;
        }
        await userModel.updateUserDataRawById(targetUserId, data);
        // Provide more informative feedback for certain items
        if (item.id === 'incubation_accelerator') {
          const mul = data.guilds[guildId].effects && data.guilds[guildId].effects.incubation_accelerator && data.guilds[guildId].effects.incubation_accelerator.multiplier;
          return respond({ content: `Used one ${item.name}. Effect applied. Multiplier: ${mul || 'unknown'} (hatch times will be multiplied by this value for the next egg).` });
        }
        return respond({ content: `Used one ${item.name}. Effect applied.` });
      } catch (e) {
        return respond({ content: `Failed to use item: ${e && e.message ? e.message : e}` });
      }
    }

    if (sub === 'combine') {
      await interaction.deferReply({ ephemeral: true });
      const item1 = interaction.options.getString('item1');
      const item2 = interaction.options.getString('item2');
      const a = findItem(item1);
      const b = findItem(item2);
      if (!a || !b) return respond({ content: 'One or both items not found.' });
      if (a.id === 'golden_gen' && b.id === 'golden_gen') {
        try {
          // Attempt to consume both items via itemsService; restore if partial failure
          const consumedA = await itemsService.consumeItemForUser(userId, guildId, a.id, 1);
          if (!consumedA || !consumedA.success) return respond({ content: 'Insufficient items to combine.' });
          const consumedB = await itemsService.consumeItemForUser(userId, guildId, b.id, 1);
          if (!consumedB || !consumedB.success) {
            // restore A
            try { await itemsService.restoreItemForUser(userId, guildId, consumedA.key || a.id, 1); } catch (_) { /* ignore */ }
            return respond({ content: 'Insufficient items to combine.' });
          }
          await userModel.addItemForGuild(userId, guildId, 'golden_fragment', 1);
          return respond({ content: 'Combined two Golden Gen into Golden Fragment.' });
        } catch (e) {
          return respond({ content: `Combine failed: ${e && e.message ? e.message : e}` });
        }
      }
      return respond({ content: 'Combine recipe not implemented for those items.' });
    }
    return respond({ content: 'Unknown subcommand.', ephemeral: true });
  },

  async autocomplete(interaction) {
    try {
      // lazy-require userModel for testability
      userModel = require('../../models/user');
      const focused = interaction.options.getFocused ? interaction.options.getFocused(true) : null;
      if (!focused) return interaction.respond([]);
      const guildId = interaction.guildId;
      const discordId = String(interaction.user.id);
      const focusedName = focused.name;

      // Autocomplete for the `item` option: suggest items in the user's inventory first, fallback to shop
      if (focusedName === 'item' || focusedName === 'item_id') {
        const u = await userModel.getUserByDiscordId(discordId);
        let inventoryItems = [];
        if (u && u.data && u.data.guilds && u.data.guilds[guildId] && u.data.guilds[guildId].items) {
          inventoryItems = Object.entries(u.data.guilds[guildId].items).map(([id, qty]) => ({ id, qty: Number(qty) })).filter(i => i.qty > 0);
        }
        if (!inventoryItems || inventoryItems.length === 0) {
          const shopItems = (require('../../../config/shop.json').items || []).slice(0, 25).map(it => ({ name: `${it.name} (0)`, value: it.id }));
          return interaction.respond(shopItems);
        }
        const q = String(focused.value || '').toLowerCase();
        const shop = require('../../../config/shop.json');
        const mapped = inventoryItems
          .filter(i => !q || i.id.toLowerCase().includes(q) || (shop.items.find(s => s.id === i.id)?.name || '').toLowerCase().includes(q))
          .slice(0, 25)
          .map(i => ({ name: `${(shop.items.find(s => s.id === i.id)?.name) || i.id} (${i.qty})`, value: i.id }));
        return interaction.respond(mapped);
      }

      // Autocomplete for `target` option: suggest user's Queen xenomorphs in this guild
      if (focusedName === 'target') {
        try {
          const xenoModel = require('../../models/xenomorph');
          const hiveModel = require('../../models/hive');
          const xenos = await xenoModel.getXenosByOwner(discordId, null, true);
          const hive = await hiveModel.getHiveByUser(discordId, guildId).catch(() => null);
          const queenId = hive && hive.queen_xeno_id ? Number(hive.queen_xeno_id) : null;

          // If the user selected the Pathogen item, allow drones as valid targets too
          const selectedItem = (() => { try { return interaction.options.getString('item'); } catch (_) { return null; } })();
          const allowDrones = selectedItem && String(selectedItem).toLowerCase() === 'pathogen';

          // Filter to xenos that belong to this guild and match allowed roles
          const filtered = [];
          for (const x of (xenos || [])) {
            const roleStr = String(x.role || x.stage || '').toLowerCase();
            const looksLikeQueen = roleStr.includes('queen') || (queenId && Number(x.id) === queenId);
            const looksLikeDrone = roleStr === 'drone' || roleStr.includes('drone');
            if (!looksLikeQueen && !(allowDrones && looksLikeDrone)) continue;

            let inGuild = false;
            if (x.guild_id && String(x.guild_id) === String(guildId)) inGuild = true;
            else if (x.hive_id) {
              try {
                const xHive = await hiveModel.getHiveById(x.hive_id);
                if (xHive && xHive.guild_id && String(xHive.guild_id) === String(guildId)) inGuild = true;
              } catch (_) { /* ignore */ }
            }
            if (inGuild) filtered.push(x);
            if (filtered.length >= 25) break;
          }

          const emojis = require('../../../config/emojis.json');
          const PATHOGEN_EMOJI = emojis.pathogen_queen;
          const candidates = filtered.map(x => {
            const roleLabel = (x.role || x.stage || x.pathway || 'xeno');
            let display;
            if (String(roleLabel).toLowerCase().includes('pathogen')) display = `${PATHOGEN_EMOJI} #${x.id}`;
            else if (String(roleLabel).toLowerCase().includes('drone')) display = `Drone #${x.id}`;
            else display = `${roleLabel} #${x.id}`;
            return { name: display, value: String(x.id) };
          });
          return interaction.respond(candidates);
          } catch (err) {
          return interaction.respond([]);
        }
      }

      return interaction.respond([]);
    } catch (e) {
      try { return interaction.respond([]); } catch (_) { /* ignore */ }
    }
  }
};
