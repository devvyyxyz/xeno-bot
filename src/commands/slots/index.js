/* eslint-env node, commonjs */
const { getCommandConfig, buildSubcommandOptions, isCommandEphemeral } = require('../../utils/commandsConfig');
void buildSubcommandOptions;
const safeReply = require('../../utils/safeReply');
const userModel = require('../../models/user');
const emojis = require('../../../config/emojis.json');
const { buildNoticeV2Payload, buildStatsV2Payload } = require('../../utils/componentsV2');
const createInteractionCollector = require('../../utils/collectorHelper');
const db = require('../../db');
const {
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
void ThumbnailBuilder;

const cmd = getCommandConfig('slots') || {
  name: 'slots',
  description: 'Bet your Royal Jelly on a simple 3-reel slots game.'
};

const SYMBOLS = [ 'royal_jelly', 'colonist', 'runner', 'praetorian', 'ox' ];

function symbolEmoji(key) {
  // Try emoji map, fallback to simple chars
  const map = emojis || {};
  return map[key] || (key === 'royal_jelly' ? '🍯' : '🔸');
}

function pick() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      { name: 'amount', description: 'Amount of royal_jelly to bet', type: 4, required: true, min_value: 1 }
    ]
  },

  async executeInteraction(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    if (!guildId) {
      await safeReply(interaction, buildNoticeV2Payload({ message: 'This command can only be used in a server.', tone: 'permission', client: interaction.client }));
      return;
    }
    const amount = Number(interaction.options && interaction.options.getInteger ? interaction.options.getInteger('amount') || 0 : 0);
    if (isNaN(amount) || amount <= 0) {
      await safeReply(interaction, buildNoticeV2Payload({ message: 'Invalid bet amount.', tone: 'error', client: interaction.client }));
      return;
    }

    // Ensure the slot_plays table exists and provide a lightweight stats store
    async function ensureSlotTable() {
      try {
        if (!db.knex) await db.migrate();
        const knex = db.knex;
        const exists = await knex.schema.hasTable('slot_plays');
        if (!exists) {
          await knex.schema.createTable('slot_plays', (table) => {
            table.increments('id').primary();
            table.string('user_id').notNullable().index();
            table.string('guild_id').nullable().index();
            table.bigInteger('bet').defaultTo(0);
            table.bigInteger('payout').defaultTo(0);
            table.integer('multiplier').defaultTo(0);
            table.boolean('is_big_win').defaultTo(false);
            table.string('result').nullable();
            table.bigInteger('created_at').notNullable();
          });
        }
      } catch (e) {
        /* non-fatal: if table cannot be created (permissions), we'll still proceed without persistent stats */
        void 0;
      }
    }

    await ensureSlotTable();

    // Helper to get counts (safe across SQL dialects)
    async function getCounts(whereClause) {
      try {
        const knex = db.knex;
        const spinsRow = await knex('slot_plays').where(whereClause).count('* as cnt').first();
        const winsRow = await knex('slot_plays').where(whereClause).where('multiplier', '>', 0).count('* as cnt').first();
        const bigRow = await knex('slot_plays').where(whereClause).where('is_big_win', true).count('* as cnt').first();
        return {
          spins: Number((spinsRow && (spinsRow.cnt || spinsRow.Cnt || spinsRow.c)) || 0),
          wins: Number((winsRow && (winsRow.cnt || winsRow.Cnt || winsRow.c)) || 0),
          big_wins: Number((bigRow && (bigRow.cnt || bigRow.Cnt || bigRow.c)) || 0)
        };
      } catch (e) {
        return { spins: 0, wins: 0, big_wins: 0 };
      }
    }

    // Get real stats (user and global)
    const userStats = await getCounts({ user_id: userId });
    const globalStats = await getCounts({});

    // Build V2 container showing stats and a single Play button
    const buildStatsContainer = () => {
      const supportBuilders = (() => {
        try { const { ButtonBuilder: BB } = require('discord.js'); return typeof BB === 'function'; } catch (_) { return false; }
      })();
      if (!supportBuilders) {
        const payload = buildStatsV2Payload({ title: '🎰 The Slot Machine', rows: [ { label: 'Your stats', value: `${userStats.spins} spins\n${userStats.wins} wins\n${userStats.big_wins} big wins` }, { label: 'Global stats', value: `${globalStats.spins} spins\n${globalStats.wins} wins\n${globalStats.big_wins} big wins` } ], footer: null, client: interaction.client });
        // Attach a raw action row with a Play button for environments without builders
        payload.components = payload.components || [];
        payload.components.push({ type: 1, components: [ { type: 2, style: 1, custom_id: 'slots-play', label: 'Play' } ] });
        if (payload.flags === undefined) payload.flags = MessageFlags.IsComponentsV2;
        return payload;
      }

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(':slot_machine:  The Slot Machine'));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('\nYour stats\n' + `${userStats.spins} spins\n${userStats.wins} wins\n${userStats.big_wins} big wins`));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('\nGlobal stats\n' + `${globalStats.spins.toLocaleString()} spins\n${globalStats.wins.toLocaleString()} wins\n${globalStats.big_wins.toLocaleString()} big wins`));

      // Action row with Play button
      const playBtn = new ButtonBuilder().setCustomId('slots-play').setLabel('Play').setStyle(ButtonStyle.Primary).setDisabled(false);
      container.addActionRowComponents(new ActionRowBuilder().addComponents(playBtn));
      return { components: [container.toJSON()], flags: MessageFlags.IsComponentsV2 };
    };

    // Send the stats view; check commands.json to decide ephemeral behavior
    const ephemeralFlag = isCommandEphemeral('slots');
    const statsPayload = buildStatsContainer();
    try {
      // If we haven't replied/deferred, reply with flags=Ephemeral (include existing payload flags)
      if (!interaction.deferred && !interaction.replied) {
        const replyOpts = Object.assign({}, statsPayload);
        replyOpts.flags = (statsPayload && statsPayload.flags) || 0;
        if (ephemeralFlag) replyOpts.flags = replyOpts.flags | MessageFlags.Ephemeral;
        // Ensure fetchReply so collectors can attach
        replyOpts.fetchReply = true;
        await interaction.reply(replyOpts);
      } else {
        // Already deferred/replied: edit the reply (ephemeral state preserved when originally ephemeral)
        await interaction.editReply(statsPayload);
      }
    } catch (e) {
      // Fallback: safeReply may not support the flags property; call with statsPayload
      try { await safeReply(interaction, statsPayload); } catch (_) { /* ignore */ void 0; }
    }

    // Attach collector for the Play button
    const { collector } = await createInteractionCollector(interaction, { time: 60_000, ephemeral: ephemeralFlag, edit: false, collectorOptions: { componentType: 2 } });
    if (!collector) return;
    collector.on('collect', async i => {
      try {
        if (i.customId !== 'slots-play') return;
        // only allow the command user to press play
        if (i.user.id !== userId) { try { await i.reply({ content: 'Only the command invoker can start this spin.', ephemeral: true }); } catch (_) { /* ignore */ void 0; } return; }
        try { await i.deferUpdate(); } catch (_) { /* ignore */ void 0; }

        // Re-check balance before spinning
        const bal = await userModel.getCurrencyForGuild(userId, guildId, 'royal_jelly');
        if (bal < amount) {
          try { await interaction.editReply(buildNoticeV2Payload({ message: `Insufficient Royal Jelly. You have ${bal}, need ${amount}.`, tone: 'error', client: interaction.client })); } catch (_) { /* ignore */ void 0; }
          return;
        }

        // Deduct bet immediately
        await userModel.modifyCurrencyForGuild(userId, guildId, 'royal_jelly', -amount);

        // Run the spin reveal sequence and then persist a play record
        const finalR1 = pick();
        const finalR2 = pick();
        const finalR3 = pick();
        const renderReels = (a, b, c) => `${symbolEmoji(a)} ${symbolEmoji(b)} ${symbolEmoji(c)}`;
        const delays = [600, 600, 800];

        // Frame 1
        await new Promise(res => setTimeout(res, delays[0]));
        try { await interaction.editReply(buildStatsV2Payload({ title: '🎰 Slots', rows: [ { label: 'Spin', value: renderReels(finalR1, pick(), pick()) }, { label: 'Status', value: 'Revealing...' } ], footer: `Bet: ${amount} RJ`, client: interaction.client })); } catch (_) { /* ignore */ void 0; }

        // Frame 2
        await new Promise(res => setTimeout(res, delays[1]));
        try { await interaction.editReply(buildStatsV2Payload({ title: '🎰 Slots', rows: [ { label: 'Spin', value: renderReels(finalR1, finalR2, pick()) }, { label: 'Status', value: 'Almost there...' } ], footer: `Bet: ${amount} RJ`, client: interaction.client })); } catch (_) { /* ignore */ void 0; }

        // Final
        await new Promise(res => setTimeout(res, delays[2]));
        const r1 = finalR1, r2 = finalR2, r3 = finalR3;
        let multiplier = 0;
        if (r1 === r2 && r2 === r3) {
          if (r1 === 'royal_jelly') multiplier = 10;
          else multiplier = 5;
        } else if (r1 === r2 || r1 === r3 || r2 === r3) {
          multiplier = 2;
        }
        const payout = multiplier > 0 ? amount * multiplier : 0;
        if (payout > 0) await userModel.modifyCurrencyForGuild(userId, guildId, 'royal_jelly', +payout);
        const newBal = await userModel.getCurrencyForGuild(userId, guildId, 'royal_jelly');
        void newBal;

        // persist play record if DB available
        try {
          if (db.knex) {
            await db.knex('slot_plays').insert({ user_id: userId, guild_id: guildId, bet: amount, payout, multiplier, is_big_win: multiplier >= 5, result: `${r1},${r2},${r3}`, created_at: Date.now() });
          }
        } catch (e) { /* ignore persistence failures */ void 0; }

        // Build final grid and result
        const gridReelsFinal = { top: [ ' ', ' ', ' ' ], mid: [ symbolEmoji(r1), symbolEmoji(r2), symbolEmoji(r3) ], bot: [ ' ', ' ', ' ' ] };
        await interaction.editReply(makeGridComponents({ title: '🎰 Slots — Result', reels: gridReelsFinal, footer: `Bet: ${amount} RJ` }));
        // Attach collector for Bet Again / Paytable on the new grid
        const { collector: gridCollector } = await createInteractionCollector(interaction, { time: 60_000, ephemeral: ephemeralFlag, edit: false, collectorOptions: { componentType: 2 } });
        if (!gridCollector) return;
        gridCollector.on('collect', async i2 => {
          try {
            if (i2.customId === 'slots-betagain') {
                if (i2.user.id !== userId) {
                try { await i2.reply({ content: 'Only the original bettor can press this.', ephemeral: true }); } catch (_) { /* ignore */ void 0; }
                return;
              }
              // re-run slots with same amount by faking options on the component interaction
              i2.options = { getInteger: (name) => (name === 'amount' ? amount : null) };
              try { i2.guildId = interaction.guildId; } catch (e) { /* ignore */ void 0; }
              await module.exports.executeInteraction(i2);
            } else if (i2.customId === 'slots-paytable') {
              const payContainer = new ContainerBuilder();
              payContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🎰 Slots — Paytable'));
              payContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Triple Royal: x10 (🍯 🍯 🍯)\nTriple Any: x5\nTwo of a Kind: x2\nLoss: No payout'));
              await safeReply(i2, { components: [payContainer], flags: MessageFlags.IsComponentsV2, ephemeral: ephemeralFlag });
            }
          } catch (err) {
            try { await i2.reply({ content: 'Action failed.', ephemeral: true }); } catch (_) { /* ignore */ void 0; }
          }
        });
      } catch (err) {
        try { await i.reply({ content: 'Action failed.', ephemeral: true }); } catch (_) { /* ignore */ void 0; }
      }
    });

    // End initial stats/show-play flow

    // The rest of the original function (grid reveal, collectors for Bet Again/Paytable)
    // is preserved below and will operate on the message when play completes.

    // (buttons are included inside the ContainerBuilder grid payload below)

    // Build a visual slots container with a 3x3 grid of disabled buttons and an action row
    const makeGridComponents = ({ title, reels, footer }) => {
      // Detect whether builder classes are supported in this environment
      const supportBuilders = (() => {
        try {
          const { ButtonBuilder: BB } = require('discord.js');
          return typeof BB === 'function';
        } catch (_e) {
          return false;
        }
      })();

      // Fallback to the old stats payload when builders aren't available
      if (!supportBuilders) {
        return buildStatsV2Payload({ title, rows: [ { label: 'Spin', value: `${reels.mid.join(' ')}` }, { label: 'Status', value: 'Result' } ], footer, client: interaction.client });
      }

      const container = new ContainerBuilder();
      const section = new SectionBuilder();
      const titleText = `## ${title}`;
      section.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
      container.addSectionComponents(section);

      // Helper to create a disabled emoji button (builders path)
      const btn = (emojiName, customId, disabled = true, style = ButtonStyle.Secondary, label) => {
        const b = new ButtonBuilder().setStyle(style).setDisabled(disabled).setCustomId(customId);
        if (label) b.setLabel(label);
        if (emojiName) b.setEmoji({ name: emojiName });
        return b;
      };

      // Top row (decorative)
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(reels.top[0], `s_top_0`, true),
          btn(reels.top[1], `s_top_1`, true),
          btn(reels.top[2], `s_top_2`, true)
        )
      );

      // Middle row (main reels) - this is the win row
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(reels.mid[0], `s_mid_0`, true),
          btn(reels.mid[1], `s_mid_1`, true),
          btn(reels.mid[2], `s_mid_2`, true)
        )
      );

      // Bottom row (decorative)
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(reels.bot[0], `s_bot_0`, true),
          btn(reels.bot[1], `s_bot_1`, true),
          btn(reels.bot[2], `s_bot_2`, true)
        )
      );

      // Action row (enabled)
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(null, `slots-betagain`, false, ButtonStyle.Primary, 'Bet Again'),
          btn(null, `slots-paytable`, false, ButtonStyle.Secondary, 'Paytable')
        )
      );

      return { components: [container.toJSON()], flags: MessageFlags.IsComponentsV2 };
    };

    const gridReelsInitial = {
      top: [ '❔', '❔', '❔' ],
      mid: [ '❔', '❔', '❔' ],
      bot: [ '❔', '❔', '❔' ]
    };
    void gridReelsInitial;

    // Do nothing here — the play collector will replace the stats with the grid
    // and attach the Bet Again / Paytable collector after the spin completes.
  }
};
