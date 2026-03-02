const { getCommandConfig } = require('../../utils/commandsConfig');
const eggTypes = require('../../../config/eggTypes.json');
const evolutions = require('../../../config/evolutions.json');
const { formatNumber } = require('../../utils/numberFormat');

const cmd = getCommandConfig('devgive') || {name: 'devgive', description: 'Developer-only: give items to users (owner only)', developerOnly: true};

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  developerOnly: true,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      {
        name: 'type',
        description: 'What to give',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'Credits', value: 'credits' },
          { name: 'Egg', value: 'egg' },
          { name: 'Xenomorph', value: 'xenomorph' },
          { name: 'Royal Jelly', value: 'royal_jelly' }
        ]
      },
      {
        name: 'user',
        description: 'User to receive the item',
        type: 6, // USER
        required: true
      },
      {
        name: 'amount',
        description: 'Amount (for credits, royal jelly, or quantity)',
        type: 10, // NUMBER
        required: false
      },
      {
        name: 'egg_type',
        description: 'Egg type (required for egg)',
        type: 3, // STRING
        required: false,
        autocomplete: true
      },
      {
        name: 'pathway',
        description: 'Evolution pathway (required for xenomorph)',
        type: 3, // STRING
        required: false,
        autocomplete: true
      },
      {
        name: 'stage',
        description: 'Evolution stage (required for xenomorph)',
        type: 3, // STRING
        required: false,
        autocomplete: true
      }
    ]
  },
  async autocomplete(interaction) {
    try {
      const ownerId = resolveOwnerId();
      if (!ownerId || String(interaction.user.id) !== String(ownerId)) return interaction.respond([]);
      
      const type = (() => { try { return interaction.options.getString('type'); } catch (_) { return null; } })();
      const focused = interaction.options.getFocused ? interaction.options.getFocused(true) : null;
      
      if (!focused) return interaction.respond([]);
      
      if (type === 'egg' && focused.name === 'egg_type') {
        const q = String(focused.value || '').toLowerCase();
        const items = eggTypes
          .filter(e => !q || String(e.id).toLowerCase().includes(q) || String(e.name || '').toLowerCase().includes(q))
          .slice(0, 25)
          .map(e => ({ name: `${e.name} (${e.id})`, value: e.id }));
        return interaction.respond(items);
      }
      
      if (type === 'xenomorph' && focused.name === 'pathway') {
        const q = String(focused.value || '').toLowerCase();
        const pathways = Object.keys(evolutions.pathways || {});
        const items = pathways
          .filter(p => !q || p.toLowerCase().includes(q))
          .map(p => {
            const desc = evolutions.pathways[p]?.description || '';
            return { name: `${p} - ${desc}`, value: p };
          })
          .slice(0, 25);
        return interaction.respond(items);
      }
      
      if (type === 'xenomorph' && focused.name === 'stage') {
        const q = String(focused.value || '').toLowerCase();
        const selectedPathway = (() => { try { return interaction.options.getString('pathway'); } catch (_) { return null; } })();
        let stages = [];
        
        if (selectedPathway && evolutions.pathways && evolutions.pathways[selectedPathway]) {
          stages = evolutions.pathways[selectedPathway].stages || [];
        } else {
          stages = Object.keys(evolutions.roles || {});
        }
        
        const items = stages
          .filter(s => !q || s.toLowerCase().includes(q) || (evolutions.roles[s]?.display || '').toLowerCase().includes(q))
          .map(s => {
            const display = evolutions.roles[s]?.display || s;
            return { name: display, value: s };
          })
          .slice(0, 25);
        return interaction.respond(items);
      }
      
      return interaction.respond([]);
    } catch (e) {
      try { return interaction.respond([]); } catch (_) { return; }
    }
  },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const ownerId = resolveOwnerId();
    if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
      await safeReply(interaction, { content: 'This command is owner-only.', ephemeral: true }, { loggerName: 'command:devgive' });
      return;
    }
    
    const type = interaction.options.getString('type');
    const target = interaction.options.getUser('user');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const userModel = require('../../models/user');
      
      if (type === 'credits') {
        const amount = interaction.options.getNumber('amount');
        if (!target || !Number.isFinite(amount)) {
          await safeReply(interaction, { content: 'Invalid user or amount.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        const newBal = await userModel.modifyCurrencyForGuild(String(target.id), null, 'credits', amount);
        await safeReply(interaction, { content: `Gave ${formatNumber(amount)} credits to ${target}. New balance: ${formatNumber(newBal)}.`, ephemeral: true }, { loggerName: 'command:devgive' });
        return;
      }
      
      if (type === 'egg') {
        const eggTypeId = interaction.options.getString('egg_type');
        const amount = Math.max(1, Number(interaction.options.getNumber('amount') || 1));
        const guildId = interaction.guildId;
        
        if (!guildId) {
          await safeReply(interaction, { content: 'This command can only be used in a server for eggs.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        
        if (!target || !eggTypeId) {
          await safeReply(interaction, { content: 'User and egg_type are required for eggs.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        
        const eggType = eggTypes.find(e => String(e.id) === String(eggTypeId));
        if (!eggType) {
          await safeReply(interaction, { content: 'Invalid egg type.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        
        await userModel.addEggsForGuild(String(target.id), String(guildId), amount, String(eggTypeId));
        await safeReply(interaction, { content: `Gave ${eggType.emoji || ''} ${eggType.name} x${amount} to ${target}.`, ephemeral: true }, { loggerName: 'command:devgive' });
        return;
      }
      
      if (type === 'xenomorph') {
        const pathway = interaction.options.getString('pathway');
        const stage = interaction.options.getString('stage');
        const amount = Math.max(1, Number(interaction.options.getNumber('amount') || 1));
        
        if (!target || !pathway || !stage) {
          await safeReply(interaction, { content: 'User, pathway, and stage are required for xenomorphs.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        
        // Verify pathway and stage exist
        const pathwayExists = evolutions.pathways && evolutions.pathways[pathway];
        const stageExists = evolutions.roles && evolutions.roles[stage];
        
        if (!pathwayExists || !stageExists) {
          await safeReply(interaction, { content: 'Invalid pathway or stage.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        
        const xenoModel = require('../../models/xenomorph');
        const emojis = require('../../utils/emojis');
        const stageDisplay = evolutions.roles[stage]?.display || stage;
        const stageEmoji = evolutions.roles[stage]?.emoji ? emojis.get(evolutions.roles[stage].emoji) : '';
        
        // Create xenomorphs
        for (let i = 0; i < amount; i++) {
          await xenoModel.createXeno(String(target.id), {
            pathway: pathway,
            role: stage,
            stage: stage,
            level: 1,
            data: { grantedBy: interaction.user.id }
          });
        }
        
        await safeReply(interaction, { content: `Gave ${stageEmoji} ${stageDisplay} (${pathway} pathway) x${amount} to ${target}.`, ephemeral: true }, { loggerName: 'command:devgive' });
        return;
      }
      
      if (type === 'royal_jelly') {
        const amount = interaction.options.getNumber('amount');
        const guildId = interaction.guildId;
        
        if (!guildId) {
          await safeReply(interaction, { content: 'This command can only be used in a server for royal jelly.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        
        if (!target || !Number.isFinite(amount)) {
          await safeReply(interaction, { content: 'Invalid user or amount.', ephemeral: true }, { loggerName: 'command:devgive' });
          return;
        }
        
        const emojis = require('../../utils/emojis');
        const jellyEmoji = emojis.get('royal_jelly') || '🍯';
        const newBal = await userModel.modifyCurrencyForGuild(String(target.id), String(guildId), 'royal_jelly', amount);
        await safeReply(interaction, { content: `Gave ${jellyEmoji} ${formatNumber(amount)} Royal Jelly to ${target}. New balance: ${formatNumber(newBal)}.`, ephemeral: true }, { loggerName: 'command:devgive' });
        return;
      }
      
      await safeReply(interaction, { content: 'Unknown type selected.', ephemeral: true }, { loggerName: 'command:devgive' });
    } catch (err) {
      await safeReply(interaction, { content: `Failed: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:devgive' });
    }
  },
  async executeMessage(message, args) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(message.author.id) !== String(ownerId)) {
      try { await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    const target = message.mentions.users && message.mentions.users.first();
    const maybeId = args && args.length ? args[0] : null;
    const amountArg = args && args.length > 1 ? args[1] : args && args.length === 1 ? args[0] : null;
    let targetId = null;
    if (target) targetId = String(target.id);
    else if (maybeId && /^\d+$/.test(maybeId)) targetId = maybeId;

    if (!targetId || !amountArg) {
      try { await message.reply({ content: 'Usage: !devgive @user <amount>', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    const amt = Number(amountArg);
    if (Number.isNaN(amt) || !Number.isFinite(amt)) {
      try { await message.reply({ content: 'Amount must be a number.', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    try {
      const userModel = require('../../models/user');
      const newBal = await userModel.modifyCurrencyForGuild(String(targetId), null, 'credits', amt);
      const mention = target ? `<@${targetId}>` : `<@${targetId}>`;
      await message.reply({ content: `Gave ${formatNumber(amt)} credits to ${mention}. New balance: ${formatNumber(newBal)}.`, allowedMentions: { repliedUser: false } });
    } catch (err) {
      try { await message.reply({ content: `Failed to give credits: ${err && (err.message || err)}`, allowedMentions: { repliedUser: false } }); } catch (e) {}
    }
  }
};
