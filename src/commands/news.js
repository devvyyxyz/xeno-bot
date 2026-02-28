const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').get('command:news');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const safeReply = require('../utils/safeReply');

const NEWS_FILE = path.join(__dirname, '..', '..', 'config', 'news.md');

function loadArticles() {
  if (!fs.existsSync(NEWS_FILE)) return [];
  const raw = fs.readFileSync(NEWS_FILE, 'utf8');
  // split on lines containing only ---
  const parts = raw.split(/^[ \t]*---[ \t]*$/m).map(s => s.trim()).filter(Boolean);
  return parts;
}

function renderArticleEmbed(article, index, total) {
  // Attempt to extract title (first markdown H1/H2), otherwise use index
  const lines = article.split(/\r?\n/).map(l => l.trim());
  let title = `News #${index + 1}`;
  for (const l of lines) {
    if (!l) continue;
    const m = l.match(/^#{1,2}\s+(.+)$/);
    if (m) { title = m[1]; break; }
    // fallback: first non-empty line as title
    title = l; break;
  }
  // Body: join lines and limit length
  const body = article.replace(/^#{1,2}\s+.*$/m, '').trim();
  const truncated = body.length > 3000 ? body.slice(0, 3000) + '\n\n*...truncated*' : body;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncated || 'No content')
    .setFooter({ text: `Article ${index + 1} of ${total}` })
    .setColor(0x5865F2)
    .setTimestamp();
  return embed;
}

function buildRow(supportBuilders, disabledLeft, disabledRight) {
  const ids = ['farleft', 'left', 'home', 'right', 'farright'];
  const labels = ['<<', '<', 'Home', '>', '>>'];
  const style = ButtonStyle.Secondary;
  if (supportBuilders) {
    const { ActionRowBuilder, ButtonBuilder } = require('discord.js');
    const row = new ActionRowBuilder();
    ids.forEach((id, idx) => {
      const btn = new ButtonBuilder()
        .setCustomId(`news:${id}`)
        .setLabel(labels[idx])
        .setStyle(style)
        .setDisabled((idx < 2 && disabledLeft) || (idx > 2 && disabledRight));
      row.addComponents(btn);
    });
    return [row];
  }
  // fallback raw
  const comps = ids.map((id, idx) => ({ type: 2, style: 2, custom_id: `news:${id}`, label: labels[idx], disabled: (idx < 2 && disabledLeft) || (idx > 2 && disabledRight) }));
  return [{ type: 1, components: comps }];
}

module.exports = {
  name: 'news',
  description: 'Read the latest news articles',
  data: { name: 'news', description: 'Read the latest news articles' },
  async executeInteraction(interaction) {
    try {
      const articles = loadArticles();
      if (!articles || articles.length === 0) {
        await safeReply(interaction, { content: 'No news articles available.', ephemeral: true }, { loggerName: 'command:news' });
        return;
      }

      let idx = 0;
      const total = articles.length;
      const supportBuilders = (() => {
        try { const { ButtonBuilder } = require('discord.js'); return typeof ButtonBuilder === 'function'; } catch (_) { return false; }
      })();

      const embed = renderArticleEmbed(articles[idx], idx, total);
      const components = buildRow(supportBuilders, idx === 0, idx === total - 1);

      const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true });

      const collector = reply.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 1000 * 60 * 10 });
      collector.on('collect', async (btn) => {
        try {
          await btn.deferUpdate();
          const [, action] = btn.customId.split(':');
          if (action === 'farleft') idx = 0;
          else if (action === 'left') idx = Math.max(0, idx - 1);
          else if (action === 'home') idx = 0;
          else if (action === 'right') idx = Math.min(total - 1, idx + 1);
          else if (action === 'farright') idx = total - 1;

          const newEmbed = renderArticleEmbed(articles[idx], idx, total);
          const newComponents = buildRow(supportBuilders, idx === 0, idx === total - 1);
          await reply.edit({ embeds: [newEmbed], components: newComponents });
        } catch (e) {
          logger.warn('Error handling news button collect', { error: e && (e.stack || e) });
        }
      });
      collector.on('end', () => {
        // disable buttons after timeout
        (async () => {
          try {
            const disabled = buildRow(supportBuilders, true, true);
            await reply.edit({ components: disabled });
          } catch (_) {}
        })();
      });
    } catch (err) {
      logger.error('Error in news command', { error: err && (err.stack || err) });
      try { await safeReply(interaction, { content: 'Failed showing news.' }, { loggerName: 'command:news' }); } catch (_) {}
    }
  },
};
