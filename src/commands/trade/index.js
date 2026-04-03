const { getCommandConfig, buildSubcommandOptions } = require('../../utils/commandsConfig');
const eggTypes = require('../../../config/eggTypes.json');
const shopConfig = require('../../../config/shop.json');
const hostsConfig = require('../../../config/hosts.json');
const evolutionsConfig = require('../../../config/evolutions.json');
const emojiMap = require('../../../config/emojis.json');
const userModel = require('../../models/user');
const hostModel = require('../../models/host');
const xenoModel = require('../../models/xenomorph');
const db = require('../../db');
const safeReply = require('../../utils/safeReply');
const { MessageFlags } = require('discord.js');
const fallbackLogger = require('../../utils/fallbackLogger');
const itemsService = require('../../services/items');
const tradesUtil = require('../../utils/trades');
const { buildStatsV2Payload } = require('../../utils/componentsV2');

const cmd = getCommandConfig('trade') || {
  name: 'trade',
  description: 'Trade eggs, items, hosts, or xenomorphs with another user.'
};

function formatOffer(offer) {
  try {
    if (!offer || typeof offer !== 'object') return 'None';
    const parts = [];
    const eggs = offer.eggs || {};
    const eggEntries = Object.entries(eggs)
      .filter(([, v]) => Number(v || 0) > 0)
      .map(([id, v]) => {
        const et = eggTypes.find(e => e.id === id) || null;
        const name = et ? et.name : id;
        const emoji = et && et.emoji ? `${et.emoji} ` : '';
        return `${emoji}${name} x${v}`.trim();
      });
    if (eggEntries.length) parts.push(`Eggs: ${eggEntries.join(', ')}`);

    const itemsCfg = shopConfig.items || [];
    const itemEntries = Object.entries(offer.items || {})
      .filter(([, v]) => Number(v || 0) > 0)
      .map(([id, v]) => {
        const it = itemsCfg.find(i => i.id === id) || null;
        const name = it ? it.name : id;
        return `${name} x${v}`;
      });
    parts.push(`Items: ${itemEntries.length ? itemEntries.join(', ') : 'None'}`);

    const hosts = (offer.hosts || []).map(h => `#${h}`);
    parts.push(`Hosts: ${hosts.length ? hosts.join(', ') : 'None'}`);

    const xenos = (offer.xenos || []).map(x => `#${x}`);
    parts.push(`Xenos: ${xenos.length ? xenos.join(', ') : 'None'}`);

    return parts.join('\n');
  } catch (e) {
    return JSON.stringify(offer);
  }
}

function countOfferUnits(offer) {
  const o = offer || {};
  let total = 0;
  total += Object.values(o.eggs || {}).reduce((s, v) => s + Number(v || 0), 0);
  total += Object.values(o.items || {}).reduce((s, v) => s + Number(v || 0), 0);
  total += (o.hosts || []).length;
  total += (o.xenos || []).length;
  return total;
}

function summarizeOffer(offer) {
  const o = offer || {};
  const eggCount = Object.values(o.eggs || {}).reduce((s, v) => s + Number(v || 0), 0);
  const itemCount = Object.values(o.items || {}).reduce((s, v) => s + Number(v || 0), 0);
  const hostCount = (o.hosts || []).length;
  const xenoCount = (o.xenos || []).length;
  const total = eggCount + itemCount + hostCount + xenoCount;
  if (!total) return 'None';
  const parts = [];
  if (eggCount) parts.push(`Eggs ${eggCount}`);
  if (itemCount) parts.push(`Items ${itemCount}`);
  if (hostCount) parts.push(`Hosts ${hostCount}`);
  if (xenoCount) parts.push(`Xenos ${xenoCount}`);
  return `${parts.join(' | ')} (Total ${total})`;
}

function buildTransferPreview(initiatorOffer, recipientOffer, initiatorId, recipientId) {
  const initiatorTag = `<@${initiatorId}>`;
  const recipientTag = `<@${recipientId}>`;
  return [
    `${recipientTag} receives: ${summarizeOffer(initiatorOffer)}`,
    `${initiatorTag} receives: ${summarizeOffer(recipientOffer)}`
  ].join('\n');
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: buildSubcommandOptions('trade', [
      {
        type: 1,
        name: 'offer',
        description: 'Propose an offer to another user',
        options: [
          { name: 'user', description: 'User to offer to', type: 6, required: true },
          // nested choice handled via additional subcommands; simplified single-item quick offer
          { name: 'egg_type', description: 'Egg type to offer', type: 3, required: false, autocomplete: true },
          { name: 'item_id', description: 'Item to offer', type: 3, required: false, autocomplete: true },
          { name: 'host_id', description: 'Host to offer', type: 3, required: false, autocomplete: true },
          { name: 'xeno_id', description: 'Xenomorph to offer', type: 3, required: false, autocomplete: true },
          { name: 'amount', description: 'Amount for eggs/items (defaults to 1)', type: 4, required: false, min_value:1 }
        ]
      },
      {
        type: 1,
        name: 'edit',
        description: "Edit your side of an existing trade (overwrite caller's offer)",
        options: [
          { name: 'trade_id', description: 'Trade ID to edit', type: 4, required: true },
          { name: 'egg_type', description: 'Egg type to offer', type: 3, required: false, autocomplete: true },
          { name: 'item_id', description: 'Item to offer', type: 3, required: false, autocomplete: true },
          { name: 'host_id', description: 'Host to offer', type: 3, required: false, autocomplete: true },
          { name: 'xeno_id', description: 'Xenomorph to offer', type: 3, required: false, autocomplete: true },
          { name: 'amount', description: 'Amount for eggs/items (defaults to 1)', type: 4, required: false, min_value:1 }
        ]
      },
      {
        type: 1,
        name: 'accept',
        description: 'Accept a pending trade',
        options: [
          { name: 'trade_id', description: 'ID of the trade', type: 4, required: true },
          { name: 'confirm', description: 'Confirm even if trade appears unbalanced', type: 5, required: false }
        ]
      },
      {
        type: 1,
        name: 'cancel',
        description: 'Cancel a pending trade you initiated',
        options: [ { name: 'trade_id', description: 'ID of the trade', type: 4, required: true } ]
      }
    ])
  },

  async autocomplete(interaction) {
    const autocomplete = require('../../utils/autocomplete');
    const focused = interaction.options.getFocused(true);
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    if (focused.name === 'egg_type') {
      try {
        const userData = await userModel.getUserByDiscordId(userId);
        const guildData = userData?.data?.guilds?.[guildId];
        const userEggs = guildData?.eggs || {};
        const availableEggs = eggTypes.filter(e => (userEggs[e.id] || 0) > 0).map(e => ({ ...e, quantity: userEggs[e.id] }));
        return autocomplete(interaction, availableEggs, { map: e => ({ name: `${e.name} (${e.quantity})`, value: e.id }), max: 25 });
      } catch (e) { fallbackLogger.error('Trade autocomplete egg_type', e); return interaction.respond([]); }
    }
    if (focused.name === 'item_id') {
      try {
        const userData = await userModel.getUserByDiscordId(userId);
        const guildData = userData?.data?.guilds?.[guildId];
        const userItems = guildData?.items || {};
        const items = shopConfig.items || [];
        const available = items.filter(i => (userItems[i.id] || 0) > 0).map(i => ({ ...i, quantity: userItems[i.id] }));
        return autocomplete(interaction, available, { map: i => ({ name: `${i.name} (${i.quantity})`, value: i.id }), max: 25 });
      } catch (e) { fallbackLogger.error('Trade autocomplete item_id', e); return interaction.respond([]); }
    }
    if (focused.name === 'host_id') {
      try {
        const hosts = await hostModel.listHostsByOwner(userId, guildId);
        const choices = hosts.map(h => ({ id: String(h.id), name: `${(hostsConfig.hosts[h.host_type]?.emoji || '')} ${hostsConfig.hosts[h.host_type]?.display || h.host_type} [${h.id}]`.substring(0,100) }));
        return autocomplete(interaction, choices, { map: h => ({ name: h.name, value: h.id }), max: 25 });
      } catch (e) { fallbackLogger.error('Trade autocomplete host_id', e); return interaction.respond([]); }
    }
    if (focused.name === 'xeno_id') {
      try {
        const xenos = await xenoModel.getXenosByOwner(userId, guildId);
        const choices = (xenos || []).map(x => ({ id: String(x.id), name: `${x.role || x.stage} [${x.id}]`.substring(0,100) }));
        return autocomplete(interaction, choices, { map: x => ({ name: x.name, value: x.id }), max: 25 });
      } catch (e) { fallbackLogger.error('Trade autocomplete xeno_id', e); return interaction.respond([]); }
    }
    return [];
  },

  async executeInteraction(interaction) {
    const logger = require('../../utils/logger').get('command:trade');
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    if (!guildId) { await safeReply(interaction, { content: 'This command can only be used in a server.', ephemeral: true }); return; }
    // Defer reply. Make `edit` subcommand ephemeral by default so responses are private.
    const deferEphemeral = (sub === 'edit');
    await interaction.deferReply({ ephemeral: deferEphemeral });
    try {
      if (sub === 'offer') {
        const recipient = interaction.options.getUser('user');
        if (!recipient) { await safeReply(interaction, { content: 'Recipient required.', ephemeral: true }); return; }
        if (recipient.id === userId) { await safeReply(interaction, { content: 'You cannot offer to yourself.', ephemeral: true }); return; }
        const botUserId = interaction?.client?.user?.id ? String(interaction.client.user.id) : null;
        const isTradeWithXenoBot = !!botUserId && String(recipient.id) === botUserId;
        if (recipient.bot && !isTradeWithXenoBot) {
          await safeReply(interaction, { content: 'You can only trade with players or XenoBot itself.', ephemeral: true });
          return;
        }
        const amount = interaction.options.getInteger('amount') || 1;
        const eggType = interaction.options.getString('egg_type');
        const itemId = interaction.options.getString('item_id');
        const hostId = interaction.options.getString('host_id');
        const xenoId = interaction.options.getString('xeno_id');

        const offer = tradesUtil.emptyOffer();
        if (eggType) offer.eggs[eggType] = Number(amount || 1);
        if (itemId) offer.items[itemId] = Number(amount || 1);
        if (hostId) offer.hosts.push(Number(hostId));
        if (xenoId) offer.xenos.push(Number(xenoId));

        // Validate ownership quickly
        const problems = await tradesUtil.validateOfferOwnership(offer, userId, guildId);
        if (problems.length) {
          await safeReply(interaction, { content: `You don't own one or more of the offered assets: ${JSON.stringify(problems)}`, ephemeral: true }, { loggerName: 'command:trade' });
          return;
        }

        // Prevent creating a new offer if the recipient has already offered you one
        try {
          const existing = await db.knex('trades').where({ initiator_id: String(recipient.id), recipient_id: String(userId), status: 'pending' }).first();
          if (existing) {
            await safeReply(interaction, { content: `${recipient} has already offered you a trade (ID ${existing.id}). Accept or cancel that trade before creating a new offer.`, ephemeral: true }, { loggerName: 'command:trade' });
            return;
          }
        } catch (e) {
          fallbackLogger.warn('Failed checking for existing incoming trade', e);
        }

        const tradeRow = await tradesUtil.createTrade(userId, recipient.id, guildId, offer);

        if (isTradeWithXenoBot) {
          const botOffer = tradesUtil.emptyOffer();
          await tradesUtil.updateTrade(tradeRow.id, { recipient_offer: JSON.stringify(botOffer) });
          const applied = await tradesUtil.applyTrade(await tradesUtil.getTradeById(tradeRow.id));
          if (!applied.success) {
            await safeReply(interaction, { content: `Failed to auto-complete bot trade: ${applied.error || 'Unknown error'}`, ephemeral: true }, { loggerName: 'command:trade' });
            return;
          }

          await safeReply(interaction, buildStatsV2Payload({
            title: '🤖 Bot Trade Completed',
            rows: [
              { label: 'From', value: String(interaction.user) },
              { label: 'To', value: String(recipient) },
              { label: 'Your Offer', value: formatOffer(offer) },
              { label: 'XenoBot Offer', value: 'None (always)' },
              { label: 'Trade ID', value: String(tradeRow.id) }
            ],
            footer: 'XenoBot always accepts and offers nothing',
            client: interaction.client
          }), { loggerName: 'command:trade' });
          logger.info('Bot trade auto-accepted', { id: tradeRow.id, from: userId, to: recipient.id, guildId });
          return;
        }

        const componentsService = require('../../services/components');
        // Try to build a V2 container with action row buttons if builders are available
        const supportBuilders = (() => {
          try { const { ButtonBuilder } = require('discord.js'); return typeof ButtonBuilder === 'function'; } catch (_) { return false; }
        })();

        const recipientOffer = tradesUtil.emptyOffer();
        let payload = buildStatsV2Payload({
          title: '🔖 Trade Offered',
          rows: [
            { label: 'From', value: String(interaction.user) },
            { label: 'To', value: String(recipient) },
            { label: 'Initiator Offer', value: formatOffer(offer) },
            { label: 'Recipient Offer', value: 'None yet (recipient can use /trade edit)' },
            { label: 'Quick Summary', value: buildTransferPreview(offer, recipientOffer, userId, recipient.id) },
            { label: 'Trade ID', value: String(tradeRow.id) }
          ],
          footer: 'Recipient must accept to complete trade',
          client: interaction.client
        });

        // Build a raw disabled action row to use when disabling buttons after accept/cancel
        const disabledActionRow = { type: 1, components: [ { type: 2, style: 1, custom_id: `trade-accept:${tradeRow.id}`, label: 'Accept', disabled: true }, { type: 2, style: 4, custom_id: `trade-cancel:${tradeRow.id}`, label: 'Cancel', disabled: true } ] };

        if (supportBuilders) {
          try {
            const { ContainerBuilder } = require('@discordjs/builders');
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            // payload.components[0] may be a ContainerBuilder instance from buildStatsV2Payload
            const container = (payload && Array.isArray(payload.components) && payload.components[0]) || new ContainerBuilder();
            const acceptBtn = new ButtonBuilder().setCustomId(`trade-accept:${tradeRow.id}`).setLabel('Accept').setStyle(ButtonStyle.Primary);
            const cancelBtn = new ButtonBuilder().setCustomId(`trade-cancel:${tradeRow.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger);
            if (typeof container.addActionRowComponents === 'function') {
              container.addActionRowComponents(new ActionRowBuilder().addComponents(acceptBtn, cancelBtn));
              payload.components = [ container.toJSON ? container.toJSON() : container ];
            } else {
              // Fallback to raw JSON action row
              payload.components = payload.components || [];
              payload.components.push({ type: 1, components: [ { type: 2, style: 1, custom_id: `trade-accept:${tradeRow.id}`, label: 'Accept' }, { type: 2, style: 4, custom_id: `trade-cancel:${tradeRow.id}`, label: 'Cancel' } ] });
            }
          } catch (e) {
            payload.components = payload.components || [];
            payload.components.push({ type: 1, components: [ { type: 2, style: 1, custom_id: `trade-accept:${tradeRow.id}`, label: 'Accept' }, { type: 2, style: 4, custom_id: `trade-cancel:${tradeRow.id}`, label: 'Cancel' } ] });
          }
        } else {
          // No builders available — attach raw action row JSON
          payload.components = payload.components || [];
          payload.components.push({ type: 1, components: [ { type: 2, style: 1, custom_id: `trade-accept:${tradeRow.id}`, label: 'Accept' }, { type: 2, style: 4, custom_id: `trade-cancel:${tradeRow.id}`, label: 'Cancel' } ] });
        }

        await componentsService.replyInteraction(interaction, payload, { loggerName: 'command:trade' });
        let msg = null; try { msg = await interaction.fetchReply(); } catch (_) { /* ignore */ }
        if (msg && typeof msg.createMessageComponentCollector === 'function') {
          const collector = msg.createMessageComponentCollector({ time: 300_000, filter: i => !!i.customId && (i.customId === `trade-accept:${tradeRow.id}` || i.customId === `trade-cancel:${tradeRow.id}`) });
          collector.on('collect', async i => {
            try {
              // Accept button
              if (i.customId === `trade-accept:${tradeRow.id}`) {
                if (String(i.user.id) !== String(recipient.id)) {
                  try { await i.reply({ content: 'Only the recipient can accept this trade.', ephemeral: true }); } catch (_) { /* ignore */ }
                  return;
                }
                // Update original message to indicate processing and remove buttons.
                // Prefer `i.update`, but fall back to deferring + direct message edit if update fails
                try {
                  await i.update({ content: 'Processing acceptance...', components: [ disabledActionRow ] });
                } catch (uErr) {
                  try { await i.deferUpdate(); } catch (_) { /* ignore */ }
                  try { if (i.message && typeof i.message.edit === 'function') await i.message.edit({ content: 'Processing acceptance...', components: [ disabledActionRow ] }); } catch (_) { /* ignore */ }
                }
                // call accept logic
                await tradesUtil.updateTrade(tradeRow.id, { recipient_offer: JSON.stringify(tradesUtil.emptyOffer()) });
                try {
                  const applied = await tradesUtil.applyTrade(await tradesUtil.getTradeById(tradeRow.id));
                  if (!applied.success) {
                    try { await i.followUp({ content: `Failed to apply trade: ${applied.error}`, ephemeral: true }); } catch (_) { /* ignore */ }
                    return;
                  }
                  try { await i.followUp({ content: `Trade ${tradeRow.id} completed successfully.`, ephemeral: false }); } catch (_) { /* ignore */ }
                } catch (err) {
                  try { await i.followUp({ content: `Failed to complete trade: ${err && err.message ? err.message : err}`, ephemeral: true }); } catch (_) { /* ignore */ }
                }
                collector.stop('done');
                return;
              }

              // Cancel button
              if (i.customId === `trade-cancel:${tradeRow.id}`) {
                // Allow initiator or recipient to cancel
                if (String(i.user.id) !== String(userId) && String(i.user.id) !== String(recipient.id)) {
                  try { await i.reply({ content: 'You cannot cancel this trade.', ephemeral: true }); } catch (_) { /* ignore */ }
                  return;
                }
                // Acknowledge interaction early to avoid "This interaction failed" and then perform cancel/edit
                try { await i.deferUpdate(); } catch (_) { /* ignore */ }
                try {
                  await tradesUtil.cancelTrade(tradeRow.id);
                } catch (err) {
                  try { if (typeof i.followUp === 'function') await i.followUp({ content: `Failed to cancel trade: ${err && (err.message || err)}`, ephemeral: true }); } catch (_) { /* ignore */ }
                  collector.stop('cancelled');
                  return;
                }
                // Edit original message to indicate cancellation and disable buttons
                try {
                  if (i.message && typeof i.message.edit === 'function') {
                    await i.message.edit({ content: `Trade ${tradeRow.id} cancelled.`, components: [ disabledActionRow ] });
                  } else if (typeof i.followUp === 'function') {
                    await i.followUp({ content: `Trade ${tradeRow.id} cancelled.`, ephemeral: true });
                  }
                } catch (e) {
                  try { if (typeof i.followUp === 'function') await i.followUp({ content: `Trade ${tradeRow.id} cancelled.`, ephemeral: true }); } catch (_) { /* ignore */ }
                }
                collector.stop('cancelled');
                return;
              }
            } catch (e) {
              try { await i.reply({ content: `Error processing button: ${e && e.message}`, ephemeral: true }); } catch (_) { /* ignore */ }
            }
          });
        }

        logger.info('Trade created', { id: tradeRow.id, from: userId, to: recipient.id, guildId });
      }

      else if (sub === 'accept') {
        const tradeId = interaction.options.getInteger('trade_id');
        const confirm = interaction.options.getBoolean('confirm') || false;
        const tradeRow = await tradesUtil.getTradeById(tradeId);
        if (!tradeRow) { await safeReply(interaction, { content: 'Trade not found.', ephemeral: true }, { loggerName: 'command:trade' }); return; }
        if (String(tradeRow.recipient_id) !== String(userId)) { await safeReply(interaction, { content: 'You are not the recipient of this trade.', ephemeral: true }, { loggerName: 'command:trade' }); return; }
        if (tradeRow.status !== 'pending') { await safeReply(interaction, { content: 'This trade is not pending.', ephemeral: true }, { loggerName: 'command:trade' }); return; }

        // If recipient hasn't provided an offer yet, assume recipient offers nothing unless client supports editing; for now require recipient to set their offer by re-offering via /trade offer? For simplicity treat empty recipient_offer as their response.
        let recipientOffer = tradeRow.recipient_offer ? JSON.parse(tradeRow.recipient_offer) : tradesUtil.emptyOffer();

        // Basic unbalanced check: compare count of objects
        const initiatorOffer = tradeRow.initiator_offer ? JSON.parse(tradeRow.initiator_offer) : tradesUtil.emptyOffer();
        const aCount = countOfferUnits(initiatorOffer);
        const bCount = countOfferUnits(recipientOffer);
        if (aCount !== bCount && !confirm) {
          await safeReply(interaction, {
            content: [
              `This trade appears unbalanced (initiator offers ${aCount} units, you offer ${bCount}).`,
              buildTransferPreview(initiatorOffer, recipientOffer, tradeRow.initiator_id, tradeRow.recipient_id),
              'Re-run with `confirm=true` to accept anyway.'
            ].join('\n')
          }, { loggerName: 'command:trade' });
          return;
        }

        // Update recipient offer on the trade if not set
        if (!tradeRow.recipient_offer) {
          await tradesUtil.updateTrade(tradeRow.id, { recipient_offer: JSON.stringify(recipientOffer) });
        }

        // Re-validate ownership before applying
        const aProblems = await tradesUtil.validateOfferOwnership(initiatorOffer, tradeRow.initiator_id, guildId);
        const bProblems = await tradesUtil.validateOfferOwnership(recipientOffer, tradeRow.recipient_id, guildId);
        if (aProblems.length || bProblems.length) {
          await safeReply(interaction, { content: `One or more offers are no longer valid: ${JSON.stringify({ aProblems, bProblems })}`, ephemeral: true }, { loggerName: 'command:trade' });
          return;
        }

        const applied = await tradesUtil.applyTrade(await tradesUtil.getTradeById(tradeRow.id));
        if (!applied.success) {
          await safeReply(interaction, { content: `Failed to apply trade: ${applied.error}`, ephemeral: true }, { loggerName: 'command:trade' });
          return;
        }

        await safeReply(interaction, buildStatsV2Payload({ title: '✅ Trade Completed', rows: [ { label: 'Trade ID', value: String(tradeRow.id) }, { label: 'Between', value: `${tradeRow.initiator_id} ↔ ${tradeRow.recipient_id}` } ], footer: 'Trade applied successfully', client: interaction.client }), { loggerName: 'command:trade' });
        logger.info('Trade accepted', { id: tradeRow.id });
      }

      else if (sub === 'edit') {
        const tradeId = interaction.options.getInteger('trade_id');
        const tradeRow = await tradesUtil.getTradeById(tradeId);
        if (!tradeRow) { await safeReply(interaction, { content: 'Trade not found.', ephemeral: true }, { loggerName: 'command:trade' }); return; }
        const caller = String(userId);
        if (String(tradeRow.initiator_id) !== caller && String(tradeRow.recipient_id) !== caller) { await safeReply(interaction, { content: 'You are not a participant in this trade.', ephemeral: true }, { loggerName: 'command:trade' }); return; }

        const amount = interaction.options.getInteger('amount') || 1;
        const eggType = interaction.options.getString('egg_type');
        const itemId = interaction.options.getString('item_id');
        const hostId = interaction.options.getString('host_id');
        const xenoId = interaction.options.getString('xeno_id');

        const offer = tradesUtil.emptyOffer();
        if (eggType) offer.eggs[eggType] = Number(amount || 1);
        if (itemId) offer.items[itemId] = Number(amount || 1);
        if (hostId) offer.hosts.push(Number(hostId));
        if (xenoId) offer.xenos.push(Number(xenoId));

        const problems = await tradesUtil.validateOfferOwnership(offer, userId, guildId);
        if (problems.length) { await safeReply(interaction, { content: `You don't own one or more of the offered assets: ${JSON.stringify(problems)}`, ephemeral: true }, { loggerName: 'command:trade' }); return; }

        // Overwrite caller's offer
        if (String(tradeRow.initiator_id) === caller) {
          await tradesUtil.updateTrade(tradeId, { initiator_offer: JSON.stringify(offer) });
        } else {
          await tradesUtil.updateTrade(tradeId, { recipient_offer: JSON.stringify(offer) });
        }

        // Reply to caller ephemerally confirming update (use flags like `hunt` does)
        await safeReply(interaction, { content: `Offer updated for trade ${tradeId}:\n${formatOffer(offer)}`, flags: MessageFlags.Ephemeral }, { loggerName: 'command:trade' });

        // Attempt to find and update the original trade message in this channel so the displayed offer updates for viewers.
        try {
          const initiatorOffer = tradeRow.initiator_offer ? JSON.parse(tradeRow.initiator_offer) : tradesUtil.emptyOffer();
          const recipientOffer = tradeRow.recipient_offer ? JSON.parse(tradeRow.recipient_offer) : tradesUtil.emptyOffer();
          const newInitiatorOffer = String(tradeRow.initiator_id) === caller ? offer : initiatorOffer;
          const newRecipientOffer = String(tradeRow.recipient_id) === caller ? offer : recipientOffer;

          const payload = buildStatsV2Payload({
            title: '🔖 Trade Offered',
            rows: [
              { label: 'From', value: String(`<@${tradeRow.initiator_id}>`) },
              { label: 'To', value: String(`<@${tradeRow.recipient_id}>`) },
              { label: 'Initiator Offer', value: formatOffer(newInitiatorOffer) },
              { label: 'Recipient Offer', value: formatOffer(newRecipientOffer) },
              { label: 'Quick Summary', value: buildTransferPreview(newInitiatorOffer, newRecipientOffer, tradeRow.initiator_id, tradeRow.recipient_id) },
              { label: 'Trade ID', value: String(tradeRow.id) }
            ],
            footer: 'Recipient must accept to complete trade',
            client: interaction.client
          });

          // Attach action buttons (same as creation)
          payload.components = payload.components || [];
          payload.components.push({ type: 1, components: [ { type: 2, style: 1, custom_id: `trade-accept:${tradeRow.id}`, label: 'Accept' }, { type: 2, style: 4, custom_id: `trade-cancel:${tradeRow.id}`, label: 'Cancel' } ] });

          // Search recent messages in the channel for the one with matching trade buttons
          if (interaction.channel && interaction.channel.messages && typeof interaction.channel.messages.fetch === 'function') {
            const msgs = await interaction.channel.messages.fetch({ limit: 100 });
            const orig = msgs.find(m => {
              try {
                if (!m.components || !Array.isArray(m.components)) return false;
                return m.components.some(row => Array.isArray(row.components) && row.components.some(c => c.customId === `trade-accept:${tradeRow.id}` || c.customId === `trade-cancel:${tradeRow.id}`));
              } catch (_) { return false; }
            });
            if (orig && typeof orig.edit === 'function') {
              try { await orig.edit(payload); } catch (e) { fallbackLogger.warn('Failed editing original trade message', e); }
            }
          }
        } catch (e) {
          fallbackLogger.warn('Failed to update original trade display', e);
        }
        return;
      }

      else if (sub === 'cancel') {
        const tradeId = interaction.options.getInteger('trade_id');
        const tradeRow = await tradesUtil.getTradeById(tradeId);
        if (!tradeRow) { await safeReply(interaction, { content: 'Trade not found.', ephemeral: true }, { loggerName: 'command:trade' }); return; }
        if (String(tradeRow.initiator_id) !== String(userId)) { await safeReply(interaction, { content: 'Only the initiator can cancel the trade.', ephemeral: true }, { loggerName: 'command:trade' }); return; }
        if (tradeRow.status !== 'pending') { await safeReply(interaction, { content: 'Cannot cancel a non-pending trade.', ephemeral: true }, { loggerName: 'command:trade' }); return; }
        await tradesUtil.cancelTrade(tradeRow.id);
        await safeReply(interaction, { content: `Trade ${tradeRow.id} cancelled.`, ephemeral: true }, { loggerName: 'command:trade' });
        logger.info('Trade cancelled', { id: tradeRow.id });
      }
    } catch (error) {
      logger.error('Trade command error', { error: error && (error.stack || error) });
      await safeReply(interaction, { content: `Failed to complete trade: ${error.message || 'Unknown error'}`, ephemeral: true }, { loggerName: 'command:trade' });
    }
  }
};
