const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const eggTypes = require('../../../config/eggTypes.json');
const shopConfig = require('../../../config/shop.json');
const hostsConfig = require('../../../config/hosts.json');
const userModel = require('../../models/user');
const hostModel = require('../../models/host');
const xenoModel = require('../../models/xenomorph');
const db = require('../../db');
const safeReply = require('../../utils/safeReply');
const fallbackLogger = require('../../utils/fallbackLogger');

const cmd = getCommandConfig('gift') || {
  name: 'gift',
  description: 'Gift items, eggs, hosts, or xenomorphs to another user.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: buildSubcommandOptions('gift', [
      {
        type: 1,
        name: 'egg',
        description: 'Gift eggs to another user',
        options: [
          { name: 'user', description: 'User to gift to', type: 6, required: true },
          { name: 'egg_type', description: 'Type of egg', type: 3, required: true, autocomplete: true },
          { name: 'amount', description: 'Number of eggs', type: 4, required: false, min_value: 1, max_value: 1000 }
        ]
      },
      {
        type: 1,
        name: 'item',
        description: 'Gift an item to another user',
        options: [
          { name: 'user', description: 'User to gift to', type: 6, required: true },
          { name: 'item_id', description: 'Item to gift', type: 3, required: true, autocomplete: true },
          { name: 'amount', description: 'Number of items', type: 4, required: false, min_value: 1, max_value: 100 }
        ]
      },
      {
        type: 1,
        name: 'host',
        description: 'Gift a host to another user',
        options: [
          { name: 'user', description: 'User to gift to', type: 6, required: true },
          { name: 'host_id', description: 'Host to gift', type: 3, required: true, autocomplete: true }
        ]
      },
      {
        type: 1,
        name: 'xenomorph',
        description: 'Gift a xenomorph to another user',
        options: [
          { name: 'user', description: 'User to gift to', type: 6, required: true },
          { name: 'xeno_id', description: 'Xenomorph to gift', type: 3, required: true, autocomplete: true }
        ]
      }
    ])
  },

  async autocomplete(interaction) {
    const autocomplete = require('../../utils/autocomplete');
    const focusedOption = interaction.options.getFocused(true);
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    
    if (focusedOption.name === 'egg_type') {
      // Get user's eggs from their inventory
      try {
        const userData = await userModel.getUserByDiscordId(userId);
        const guildData = userData?.data?.guilds?.[guildId];
        const userEggs = guildData?.eggs || {};
        
        // Filter to only eggs they have > 0
        const availableEggs = eggTypes.filter(e => (userEggs[e.id] || 0) > 0).map(e => ({
          ...e,
          quantity: userEggs[e.id]
        }));
        
        return autocomplete(interaction, availableEggs, { 
          map: e => ({ name: `${e.name} (${e.quantity} available)`, value: e.id }), 
          max: 25 
        });
      } catch (error) {
        fallbackLogger.error('Gift autocomplete error (egg_type):', error);
        // Return empty array if error - don't show eggs user doesn't have
        return interaction.respond([]);
      }
    }
    
    if (focusedOption.name === 'item_id') {
      // Get user's items from their inventory
      try {
        const userData = await userModel.getUserByDiscordId(userId);
        const guildData = userData?.data?.guilds?.[guildId];
        const userItems = guildData?.items || {};
        
        // Filter to only items they have > 0
        const items = shopConfig.items || [];
        const availableItems = items.filter(i => (userItems[i.id] || 0) > 0).map(i => ({
          ...i,
          quantity: userItems[i.id]
        }));
        
        return autocomplete(interaction, availableItems, { 
          map: i => ({ name: `${i.name} (${i.quantity} available)`, value: i.id }), 
          max: 25 
        });
      } catch (error) {
        fallbackLogger.error('Gift autocomplete error (item_id):', error);
        // Return empty array if error - don't show items user doesn't have
        return interaction.respond([]);
      }
    }
    
    if (focusedOption.name === 'host_id') {
      // Get user's hosts
      try {
        const hosts = await hostModel.listHostsByOwner(userId);
        const emojiMap = require('../../../config/emojis.json');
        
        const hostChoices = hosts.map(h => {
          const hostType = hostsConfig.hosts[h.host_type];
          const emoji = hostType?.emoji && emojiMap[hostType.emoji] ? emojiMap[hostType.emoji] : '';
          const hostName = hostType?.display || h.host_type;
          return {
            id: String(h.id),
            name: `${emoji} ${hostName} (ID: ${h.id})`.substring(0, 100)
          };
        });
        
        return autocomplete(interaction, hostChoices, { 
          map: h => ({ name: h.name, value: h.id }), 
          max: 25 
        });
      } catch (error) {
        fallbackLogger.error('Gift autocomplete error (host_id):', error);
        return interaction.respond([]);
      }
    }
    
    if (focusedOption.name === 'xeno_id') {
      // Get user's xenomorphs
      try {
        const xenos = await xenoModel.getXenosByOwner(userId);
        const pathwayConfig = require('../../../config/evolutions.json');
        
        const xenoChoices = xenos.map(x => {
          const pathway = pathwayConfig.pathways?.[x.pathway];
          const stageName = pathway?.stages?.[x.stage]?.name || x.stage;
          return {
            id: String(x.id),
            name: `${stageName} - ${x.pathway} (ID: ${x.id})`.substring(0, 100)
          };
        });
        
        return autocomplete(interaction, xenoChoices, { 
          map: x => ({ name: x.name, value: x.id }), 
          max: 25 
        });
      } catch (error) {
        fallbackLogger.error('Gift autocomplete error (xeno_id):', error);
        return interaction.respond([]);
      }
    }
    
    return [];
  },

  async executeInteraction(interaction) {
    const logger = require('../../utils/logger').get('command:gift');
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const guildId = interaction.guildId;
    const senderId = interaction.user.id;

    if (!guildId) {
      await safeReply(interaction, { content: 'This command can only be used in a server.', ephemeral: true }, { loggerName: 'command:gift' });
      return;
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      if (sub === 'egg') {
        const recipient = interaction.options.getUser('user');
        const eggTypeId = interaction.options.getString('egg_type');
        const amount = interaction.options.getInteger('amount') || 1;

        if (recipient.id === senderId) {
          await safeReply(interaction, { content: 'You cannot gift items to yourself!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (recipient.bot) {
          await safeReply(interaction, { content: 'You cannot gift items to bots!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        const eggType = eggTypes.find(e => e.id === eggTypeId);
        if (!eggType) {
          await safeReply(interaction, { content: 'Invalid egg type.', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        // Check sender has enough eggs
        const senderData = await userModel.getUserByDiscordId(senderId);
        const senderGuildData = senderData?.data?.guilds?.[guildId];
        const senderEggs = senderGuildData?.eggs?.[eggTypeId] || 0;

        if (senderEggs < amount) {
          await safeReply(interaction, { 
            content: `You don't have enough ${eggType.emoji} ${eggType.name}! You have ${senderEggs}, but need ${amount}.`, 
            ephemeral: true 
          }, { loggerName: 'command:gift' });
          return;
        }

        // Remove from sender
        await userModel.removeEggsForGuild(senderId, guildId, eggTypeId, amount);
        
        // Add to recipient
        await userModel.addEggsForGuild(recipient.id, guildId, amount, eggTypeId);

        await safeReply(interaction, { 
          content: `🎁 ${interaction.user} gifted ${eggType.emoji} **${eggType.name}** x${amount} to ${recipient}!` 
        }, { loggerName: 'command:gift' });

        logger.info('Egg gift completed', { sender: senderId, recipient: recipient.id, eggType: eggTypeId, amount, guildId });
      }

      else if (sub === 'item') {
        const recipient = interaction.options.getUser('user');
        const itemId = interaction.options.getString('item_id');
        const amount = interaction.options.getInteger('amount') || 1;

        if (recipient.id === senderId) {
          await safeReply(interaction, { content: 'You cannot gift items to yourself!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (recipient.bot) {
          await safeReply(interaction, { content: 'You cannot gift items to bots!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        const item = (shopConfig.items || []).find(i => i.id === itemId);
        if (!item) {
          await safeReply(interaction, { content: 'Invalid item.', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        // Check sender has enough items
        const senderData = await userModel.getUserByDiscordId(senderId);
        const senderGuildData = senderData?.data?.guilds?.[guildId];
        const senderItems = senderGuildData?.items?.[itemId] || 0;

        if (senderItems < amount) {
          const emojiMap = require('../../../config/emojis.json');
          const emoji = item.emoji && emojiMap[item.emoji] ? emojiMap[item.emoji] : '';
          await safeReply(interaction, { 
            content: `You don't have enough ${emoji} ${item.name}! You have ${senderItems}, but need ${amount}.`, 
            ephemeral: true 
          }, { loggerName: 'command:gift' });
          return;
        }

        // Remove from sender
        await userModel.removeItemForGuild(senderId, guildId, itemId, amount);
        
        // Add to recipient
        await userModel.addItemForGuild(recipient.id, guildId, itemId, amount);

        const emojiMap = require('../../../config/emojis.json');
        const emoji = item.emoji && emojiMap[item.emoji] ? emojiMap[item.emoji] : '';
        await safeReply(interaction, { 
          content: `🎁 ${interaction.user} gifted ${emoji} **${item.name}** x${amount} to ${recipient}!` 
        }, { loggerName: 'command:gift' });

        logger.info('Item gift completed', { sender: senderId, recipient: recipient.id, itemId, amount, guildId });
      }

      else if (sub === 'host') {
        const recipient = interaction.options.getUser('user');
        const hostId = Number(interaction.options.getString('host_id'));

        if (isNaN(hostId)) {
          await safeReply(interaction, { content: 'Invalid host ID.', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (recipient.id === senderId) {
          await safeReply(interaction, { content: 'You cannot gift items to yourself!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (recipient.bot) {
          await safeReply(interaction, { content: 'You cannot gift items to bots!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        // Check host exists and belongs to sender
        const host = await hostModel.getHostById(hostId);
        if (!host) {
          await safeReply(interaction, { content: 'Host not found.', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (host.owner_id !== senderId) {
          await safeReply(interaction, { content: 'You do not own this host!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        // Transfer ownership
        await db.knex('hosts').where({ id: hostId }).update({ owner_id: recipient.id });

        const hostType = hostsConfig.hosts[host.host_type];
        const emojiMap = require('../../../config/emojis.json');
        const emoji = hostType?.emoji && emojiMap[hostType.emoji] ? emojiMap[hostType.emoji] : '';
        const hostName = hostType?.display || host.host_type;

        await safeReply(interaction, { 
          content: `🎁 ${interaction.user} gifted ${emoji} **${hostName}** (ID: ${hostId}) to ${recipient}!` 
        }, { loggerName: 'command:gift' });

        logger.info('Host gift completed', { sender: senderId, recipient: recipient.id, hostId, hostType: host.host_type });
      }

      else if (sub === 'xenomorph') {
        const recipient = interaction.options.getUser('user');
        const xenoId = Number(interaction.options.getString('xeno_id'));

        if (isNaN(xenoId)) {
          await safeReply(interaction, { content: 'Invalid xenomorph ID.', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (recipient.id === senderId) {
          await safeReply(interaction, { content: 'You cannot gift items to yourself!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (recipient.bot) {
          await safeReply(interaction, { content: 'You cannot gift items to bots!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        // Check xenomorph exists and belongs to sender
        const xeno = await xenoModel.getXenoById(xenoId);
        if (!xeno) {
          await safeReply(interaction, { content: 'Xenomorph not found.', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        if (xeno.owner_id !== senderId) {
          await safeReply(interaction, { content: 'You do not own this xenomorph!', ephemeral: true }, { loggerName: 'command:gift' });
          return;
        }

        // Check if xenomorph is in evolution queue
        const evolutionQueue = await db.knex('evolution_queue').where({ xeno_id: xenoId }).first();
        if (evolutionQueue) {
          await safeReply(interaction, { 
            content: 'Cannot gift a xenomorph that is currently evolving!', 
            ephemeral: true 
          }, { loggerName: 'command:gift' });
          return;
        }

        // Transfer ownership and clear hive assignment to avoid implicit reassignment on return gifts
        await db.knex('xenomorphs').where({ id: xenoId }).update({ owner_id: recipient.id, hive_id: null });

        const pathwayConfig = require('../../../config/evolutions.json');
        const pathway = pathwayConfig.pathways?.[xeno.pathway];
        const stageName = pathway?.stages?.[xeno.stage]?.name || xeno.stage;

        await safeReply(interaction, { 
          content: `🎁 ${interaction.user} gifted **${stageName}** xenomorph (ID: ${xenoId}) to ${recipient}!` 
        }, { loggerName: 'command:gift' });

        logger.info('Xenomorph gift completed', { sender: senderId, recipient: recipient.id, xenoId, stage: xeno.stage, pathway: xeno.pathway });
      }

    } catch (error) {
      logger.error('Gift command error', { error: error && (error.stack || error), sub });
      await safeReply(interaction, { 
        content: `Failed to complete gift: ${error.message || 'Unknown error'}`, 
        ephemeral: true 
      }, { loggerName: 'command:gift' });
    }
  }
};
