const db = require('../../db');
const safeReply = require('../../utils/safeReply');
const tradesUtil = require('../../utils/trades');
const eggTypes = require('../../../config/eggTypes.json');
const shopConfig = require('../../../config/shop.json');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');

function formatOffer(offer) {
  try {
    if (!offer || typeof offer !== 'object') return 'None';

    const parts = [];

    const eggs = offer.eggs || {};
    const eggEntries = Object.entries(eggs)
      .filter(([, value]) => Number(value || 0) > 0)
      .map(([id, value]) => {
        const eggType = eggTypes.find((entry) => entry.id === id) || null;
        const name = eggType ? eggType.name : id;
        const emoji = eggType && eggType.emoji ? `${eggType.emoji} ` : '';
        return `${emoji}${name} x${value}`.trim();
      });
    if (eggEntries.length) parts.push(`Eggs: ${eggEntries.join(', ')}`);

    const itemsCfg = shopConfig.items || [];
    const itemEntries = Object.entries(offer.items || {})
      .filter(([, value]) => Number(value || 0) > 0)
      .map(([id, value]) => {
        const item = itemsCfg.find((entry) => entry.id === id) || null;
        const name = item ? item.name : id;
        return `${name} x${value}`;
      });
    parts.push(`Items: ${itemEntries.length ? itemEntries.join(', ') : 'None'}`);

    const hosts = (offer.hosts || []).map((hostId) => `#${hostId}`);
    parts.push(`Hosts: ${hosts.length ? hosts.join(', ') : 'None'}`);

    const xenos = (offer.xenos || []).map((xenoId) => `#${xenoId}`);
    parts.push(`Xenos: ${xenos.length ? xenos.join(', ') : 'None'}`);

    return parts.join('\n');
  } catch (error) {
    return JSON.stringify(offer);
  }
}

function countOfferUnits(offer) {
  const normalized = offer || {};
  return Object.values(normalized.eggs || {}).reduce((sum, value) => sum + Number(value || 0), 0)
    + Object.values(normalized.items || {}).reduce((sum, value) => sum + Number(value || 0), 0)
    + (normalized.hosts || []).length
    + (normalized.xenos || []).length;
}

function parseOffer(rawOffer) {
  return rawOffer ? JSON.parse(rawOffer) : tradesUtil.emptyOffer();
}

function formatDate(ts) {
  const date = new Date(ts || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toLocaleString() : date.toLocaleString();
}

function buildTradeLine(row, userId) {
  const initiatorOffer = parseOffer(row.initiator_offer);
  const recipientOffer = parseOffer(row.recipient_offer);
  const counterpartId = String(row.initiator_id) === String(userId) ? row.recipient_id : row.initiator_id;

  return {
    id: row.id,
    initiatorId: row.initiator_id,
    recipientId: row.recipient_id,
    counterpartId,
    updatedAt: row.updated_at,
    units: countOfferUnits(initiatorOffer) + countOfferUnits(recipientOffer),
    text: [
      `From <@${row.initiator_id}> → <@${row.recipient_id}>`,
      `A: ${formatOffer(initiatorOffer)}`,
      `B: ${formatOffer(recipientOffer)}`,
      `Updated: ${formatDate(row.updated_at)}`
    ].join('\n')
  };
}

function buildPageSummary(pageRows, sortMode, pageIndex, totalPages, userId = null) {
  if (!pageRows.length) {
    return {
      summaryRows: [
        { label: 'Page', value: `${pageIndex + 1} / ${totalPages}` },
        { label: 'Trades', value: '0' },
        { label: 'Page Summary', value: 'No completed trades on this page.' }
      ],
      body: '_No completed trades found._'
    };
  }

  const totalUnits = pageRows.reduce((sum, row) => sum + row.units, 0);
  const uniquePartners = new Set(pageRows.map((row) => row.counterpartId)).size;
  const initiatorCount = userId
    ? pageRows.filter((row) => String(row.initiatorId) === String(userId)).length
    : 0;
  const recipientCount = pageRows.length - initiatorCount;
  const updatedTimes = pageRows
    .map((row) => Number(new Date(row.updatedAt || 0).getTime()))
    .filter((value) => Number.isFinite(value));
  const newest = updatedTimes.length ? Math.max(...updatedTimes) : null;
  const oldest = updatedTimes.length ? Math.min(...updatedTimes) : null;

  return {
    summaryRows: [
      { label: 'Page', value: `${pageIndex + 1} / ${totalPages}` },
      { label: 'Trades', value: String(pageRows.length) },
      { label: 'Units Moved', value: String(totalUnits) },
      { label: 'Unique Partners', value: String(uniquePartners) },
      { label: 'Sort Mode', value: sortMode },
      { label: 'Date Range', value: newest && oldest ? `${formatDate(newest)} to ${formatDate(oldest)}` : formatDate(pageRows[0].updatedAt) }
    ],
    body: [
      '**Page Summary**',
      `Trades on this page: ${pageRows.length}`,
      `Total units moved: ${totalUnits}`,
      `Unique partners: ${uniquePartners}`,
      `You were initiator on ${initiatorCount} trade${initiatorCount === 1 ? '' : 's'} and recipient on ${recipientCount} trade${recipientCount === 1 ? '' : 's'}.`
    ].join('\n')
  };
}

module.exports = {
  name: 'trade-log',
  description: 'View your past trades and transactions.',
  data: { name: 'trade-log', description: 'View your past trades and transactions' },
  async executeInteraction(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    try {
      const knex = db.knex;
      if (!knex) {
        await interaction.reply({ content: 'Trade logs are unavailable (DB not initialized).', ephemeral: true });
        return;
      }

      const rows = await knex('trades')
        .where(function () { this.where('initiator_id', String(userId)).orWhere('recipient_id', String(userId)); })
        .andWhere('guild_id', String(guildId))
        .andWhere('status', 'accepted')
        .orderBy('updated_at', 'desc')
        .limit(50)
        .select('id', 'initiator_id', 'recipient_id', 'initiator_offer', 'recipient_offer', 'updated_at');

      if (!rows || !rows.length) {
        await interaction.reply({ content: 'No completed trades found.', ephemeral: true });
        return;
      }

      const items = rows.map((row) => buildTradeLine(row, userId));

      // Build V2 paged view using builders if available
      try {
        const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, ActionRowBuilder, SecondaryButtonBuilder } = require('@discordjs/builders');
        const { MessageFlags } = require('discord.js');
        const sepSize = (SeparatorSpacingSize && SeparatorSpacingSize.Small) || 1;

        // Sorting helpers
        function sortRows(rowsIn, mode) {
          const out = Array.isArray(rowsIn) ? rowsIn.slice() : [];
          if (mode === 'oldest') return out.sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));
          if (mode === 'partner') return out.sort((a, b) => {
            const pa = (a.initiator_id === userId) ? a.recipient_id : a.initiator_id;
            const pb = (b.initiator_id === userId) ? b.recipient_id : b.initiator_id;
            return String(pa).localeCompare(String(pb));
          });
          // default recent
          return out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        }

        function buildPages(sortedRows, pageSize = 4) {
          const pages = [];
          for (let i = 0; i < sortedRows.length; i += pageSize) pages.push(sortedRows.slice(i, i + pageSize));
          return pages.length ? pages : [[]];
        }

        function buildComponents(pages, pageIndex, sortMode, expired = false) {
          const pageRows = pages[pageIndex] || [];
          const pageEntries = pageRows.map((row) => buildTradeLine(row, userId));
          const pageSummary = buildPageSummary(pageEntries, sortMode, pageIndex, Math.max(1, pages.length), userId);

          const container = new ContainerBuilder();
          addV2TitleWithBotThumbnail({ container, title: '🧾 Trade Log', client: interaction.client });
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              `Total trades: ${rows.length}`,
              `Sort mode: ${sortMode}`,
              pageSummary.body
            ].join('\n\n'))
          );

          if (pageEntries.length) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(sepSize).setDivider(true));
            for (const entry of pageEntries) {
              container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**Trade ${entry.id}**\n${entry.text}`)
              );
              container.addSeparatorComponents(new SeparatorBuilder().setSpacing(sepSize).setDivider(false));
            }
          }

          if (!expired) {
            // Sort select
            const sortOptions = [
              { label: 'Most recent', value: 'recent', default: sortMode === 'recent' },
              { label: 'Oldest first', value: 'oldest', default: sortMode === 'oldest' },
              { label: 'Sort by partner', value: 'partner', default: sortMode === 'partner' }
            ];
            container.addActionRowComponents(new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId('tradelog-sort').setPlaceholder('Sort trades').addOptions(...sortOptions)
            ));

            // Pagination buttons
            const pageText = pages.length > 1 ? `Page ${pageIndex + 1} of ${pages.length}` : 'Page 1';
            const navRow = new ActionRowBuilder().addComponents(
              new SecondaryButtonBuilder().setCustomId('tradelog-prev').setLabel('Previous').setDisabled(pageIndex === 0),
              new SecondaryButtonBuilder().setCustomId('tradelog-page-info').setLabel(pageText || 'Navigation').setDisabled(true),
              new SecondaryButtonBuilder().setCustomId('tradelog-next').setLabel('Next').setDisabled(pageIndex >= pages.length - 1)
            );
            container.addActionRowComponents(navRow);
          }

          return [container];
        }

        // Prepare sorted rows and pages
        let sortMode = 'recent';
        let sorted = sortRows(rows, sortMode);
        let pagesArr = buildPages(sorted, 4);
        let pageIdx = 0;

        // Send initial V2 view
        const initialComponents = buildComponents(pagesArr, pageIdx, sortMode, false);
        await safeReply(
          interaction,
          { components: initialComponents, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral },
          { loggerName: 'command:trade-log' }
        );
        const msg2 = await interaction.fetchReply();
        if (!msg2 || typeof msg2.createMessageComponentCollector !== 'function') {
          await interaction.followUp({ content: 'Failed to render trade log UI.', ephemeral: true });
          return;
        }

        const collector = msg2.createMessageComponentCollector({ filter: () => true, time: 120_000 });
        collector.on('collect', async i => {
          try {
            if (i.user.id !== interaction.user.id) { await safeReply(i, { content: 'These controls are reserved for the user who opened this view.', ephemeral: true }, { loggerName: 'command:trade-log' }); return; }
            if (i.customId === 'tradelog-sort') {
              sortMode = i.values && i.values[0] ? i.values[0] : 'recent';
              sorted = sortRows(rows, sortMode);
              pagesArr = buildPages(sorted, 4);
              pageIdx = 0;
              await i.update({ components: buildComponents(pagesArr, pageIdx, sortMode, false), flags: MessageFlags.IsComponentsV2 });
              return;
            }
            if (i.customId === 'tradelog-prev' || i.customId === 'tradelog-next') {
              if (i.customId === 'tradelog-next' && pageIdx < pagesArr.length - 1) pageIdx++;
              if (i.customId === 'tradelog-prev' && pageIdx > 0) pageIdx--;
              await i.update({ components: buildComponents(pagesArr, pageIdx, sortMode, false), flags: MessageFlags.IsComponentsV2 });
              return;
            }
          } catch (err) {
            try { await safeReply(i, { content: 'Failed to update trade log view.', ephemeral: true }, { loggerName: 'command:trade-log' }); } catch (_) { /* ignore */ }
          }
        });

        collector.on('end', async () => {
          try { if (msg2) await msg2.edit({ components: buildComponents(pagesArr, pageIdx, sortMode, true), flags: MessageFlags.IsComponentsV2 }); } catch (_) { /* ignore */ }
        });
        return;
      } catch (e) {
        // builder unavailable — fall back to plain text
      }

      // Fallback: plain text
      const pageSummary = buildPageSummary(items, 'recent', 0, 1, userId);
      const displayText = [
        `**Trade Log**`,
        pageSummary.body,
        ...items.map((item) => `**Trade ${item.id}**\n${item.text}`)
      ].join('\n\n');
      try { await interaction.reply({ content: displayText, ephemeral: true }); } catch (_) { try { await interaction.followUp({ content: displayText, ephemeral: true }); } catch (_) { /* ignore */ } }
    } catch (err) {
      try { await interaction.reply({ content: `Failed to load trade log: ${err && err.message ? err.message : err}`, ephemeral: true }); } catch (_) { /* ignore */ }
    }
  }
};
