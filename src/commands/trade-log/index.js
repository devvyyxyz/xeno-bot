const db = require('../../db');
const { buildStatsV2Payload } = require('../../utils/componentsV2');

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

      const items = rows.map(r => {
        const a = r.initiator_offer ? JSON.parse(r.initiator_offer) : { eggs: {}, items: {}, hosts: [], xenos: [] };
        const b = r.recipient_offer ? JSON.parse(r.recipient_offer) : { eggs: {}, items: {}, hosts: [], xenos: [] };
        const fmt = (o) => {
          const parts = [];
          const eggKeys = Object.keys(o.eggs || {}).filter(k => Number(o.eggs[k] || 0) > 0).map(k => `${k} x${o.eggs[k]}`);
          if (eggKeys.length) parts.push(`Eggs: ${eggKeys.join(', ')}`);
          const itemKeys = Object.keys(o.items || {}).filter(k => Number(o.items[k] || 0) > 0).map(k => `${k} x${o.items[k]}`);
          if (itemKeys.length) parts.push(`Items: ${itemKeys.join(', ')}`);
          if ((o.hosts || []).length) parts.push(`Hosts: ${(o.hosts || []).map(h => `#${h}`).join(', ')}`);
          if ((o.xenos || []).length) parts.push(`Xenos: ${(o.xenos || []).map(x => `#${x}`).join(', ')}`);
          return parts.length ? parts.join(' | ') : 'None';
        };

        const line = `From <@${r.initiator_id}> → <@${r.recipient_id}>\nA: ${fmt(a)}\nB: ${fmt(b)}\n${new Date(r.updated_at || Date.now()).toLocaleString()}`;
        return { id: r.id, text: line };
      });

      // Build V2 paged view using builders if available
      try {
        const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, ActionRowBuilder } = require('@discordjs/builders');
        const { SecondaryButtonBuilder } = require('@discordjs/builders');
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
          const container = new ContainerBuilder();
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🧾 Trade Log — ${rows.length} entries`));
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(sepSize).setDivider(true));

          const pageRows = pages[pageIndex] || [];
          if (!pageRows.length) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_No completed trades found._'));
          } else {
            for (const r of pageRows) {
              const partner = (r.initiator_id === userId) ? r.recipient_id : r.initiator_id;
              const a = r.initiator_offer ? JSON.parse(r.initiator_offer) : { eggs: {}, items: {}, hosts: [], xenos: [] };
              const b = r.recipient_offer ? JSON.parse(r.recipient_offer) : { eggs: {}, items: {}, hosts: [], xenos: [] };
              const line = `From <@${r.initiator_id}> → <@${r.recipient_id}>\nA: ${formatOffer(a)}\nB: ${formatOffer(b)}\n${new Date(r.updated_at || Date.now()).toLocaleString()}`;
              container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Trade ${r.id}**\n${line}`));
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
            const pageText = pages.length > 1 ? `Page ${pageIndex + 1} of ${pages.length}` : '';
            const navRow = new ActionRowBuilder().addComponents(
              new SecondaryButtonBuilder().setCustomId('tradelog-prev').setLabel('Previous').setDisabled(pageIndex === 0),
              new SecondaryButtonBuilder().setCustomId('tradelog-page-info').setLabel(pageText || 'Navigation').setDisabled(true),
              new SecondaryButtonBuilder().setCustomId('tradelog-next').setLabel('Next').setDisabled(pageIndex >= pages.length - 1)
            );
            container.addActionRowComponents(navRow);
          }

          const footer = expired ? `_Page ${pageIndex + 1} of ${Math.max(1, pages.length)} • View expired_` : `_Page ${pageIndex + 1} of ${Math.max(1, pages.length)}_`;
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
          return [container.toJSON ? container.toJSON() : container];
        }

        // Prepare sorted rows and pages
        let sortMode = 'recent';
        let sorted = sortRows(rows, sortMode);
        let pagesArr = buildPages(sorted, 4);
        let pageIdx = 0;

        // Send initial V2 view
        const initialComponents = buildComponents(pagesArr, pageIdx, sortMode, false);
        await interaction.reply({ components: initialComponents, flags: MessageFlags.IsComponentsV2, ephemeral: true });
        const msg2 = await interaction.fetchReply();
        if (!msg2 || typeof msg2.createMessageComponentCollector !== 'function') {
          await interaction.followUp({ content: 'Failed to render trade log UI.', ephemeral: true });
          return;
        }

        const collector = msg2.createMessageComponentCollector({ filter: () => true, time: 120_000 });
        collector.on('collect', async i => {
          try {
            if (i.user.id !== interaction.user.id) { await safeReply(i, { content: 'These controls are reserved for the user who opened this view.', ephemeral: true }); return; }
            if (i.customId === 'tradelog-sort') {
              sortMode = i.values && i.values[0] ? i.values[0] : 'recent';
              sorted = sortRows(rows, sortMode);
              pagesArr = buildPages(sorted, 4);
              pageIdx = 0;
              await i.update({ components: buildComponents(pagesArr, pageIdx, sortMode, false) });
              return;
            }
            if (i.customId === 'tradelog-prev' || i.customId === 'tradelog-next') {
              if (i.customId === 'tradelog-next' && pageIdx < pagesArr.length - 1) pageIdx++;
              if (i.customId === 'tradelog-prev' && pageIdx > 0) pageIdx--;
              await i.update({ components: buildComponents(pagesArr, pageIdx, sortMode, false) });
              return;
            }
          } catch (err) {
            try { await safeReply(i, { content: 'Failed to update trade log view.', ephemeral: true }); } catch (_) { /* ignore */ }
          }
        });

        collector.on('end', async () => {
          try { if (msg2) await msg2.edit({ components: buildComponents(pagesArr, pageIdx, sortMode, true) }); } catch (_) { /* ignore */ }
        });
        return;
      } catch (e) {
        // builder unavailable — fall back to plain text
      }

      // Fallback: plain text
      const displayText = items.map(it => `**Trade ${it.id}**\n${it.text}`).join('\n\n');
      try { await interaction.reply({ content: displayText, ephemeral: true }); } catch (_) { try { await interaction.followUp({ content: displayText, ephemeral: true }); } catch (_) { /* ignore */ } }
    } catch (err) {
      try { await interaction.reply({ content: `Failed to load trade log: ${err && err.message ? err.message : err}`, ephemeral: true }); } catch (_) { /* ignore */ }
    }
  }
};
