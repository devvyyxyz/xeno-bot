const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').get('command:news');
const links = require('../../config/links.json');
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

      // Start on the Home page view
      let idx = 0;
      let showHome = true;
      const total = articles.length;
      const supportBuilders = (() => {
        try { const { ButtonBuilder } = require('discord.js'); return typeof ButtonBuilder === 'function'; } catch (_) { return false; }
      })();

      // Build a home embed that shows introduction, quick links, and latest article
      const buildHomeEmbed = (linksObj, latestArticle, totalCount) => {
        const pageLinks = linksObj || {};
        const embed = new EmbedBuilder()
          .setTitle('📢 News')
          .setColor(0x5865F2)
          .setTimestamp();

        // Introduction
        embed.addFields({ name: 'Introduction', value: "Welcome to the Xeno Bot news hub — read the latest updates, find quick links, and browse recent articles.", inline: false });

        // Quick Links: list categorized links from config/links.json
        try {
          const categories = Object.keys(pageLinks);
          if (categories.length === 0) {
            embed.addFields({ name: 'Quick Links', value: 'No quick links configured.', inline: false });
          } else {
            let linksText = '';
            for (const cat of categories) {
              const items = pageLinks[cat] || {};
              const displayCat = String(cat).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              linksText += `**${displayCat}**\n`;
              for (const [key, url] of Object.entries(items)) {
                try {
                  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                    const label = String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    linksText += `• [${label}](${url})\n`;
                  }
                } catch (e) { /* ignore malformed entries */ }
              }
              linksText += '\n';
            }
            embed.addFields({ name: 'Quick Links', value: linksText.trim() || 'No quick links configured.', inline: false });
          }
        } catch (e) {
          embed.addFields({ name: 'Quick Links', value: 'Failed to load quick links.', inline: false });
        }

        // Latest article preview
        if (latestArticle) {
          const artEmbed = renderArticleEmbed(latestArticle, 0, totalCount);
          const title = artEmbed.data && artEmbed.data.title ? artEmbed.data.title : 'Latest Article';
          const desc = artEmbed.data && artEmbed.data.description ? artEmbed.data.description : 'No content';
          embed.addFields({ name: `Latest: ${title}`, value: desc.length > 1000 ? desc.slice(0, 997) + '...' : desc, inline: false });
        } else {
          embed.addFields({ name: 'Latest Article', value: 'No articles available.', inline: false });
        }

        return embed;
      };

      const embed = buildHomeEmbed(links.general || links, articles[0], total);
      const components = buildRow(supportBuilders, true, total === 0);

      const createCollector = require('../utils/collectorHelper');
      const { collector, message } = await createCollector(interaction, { embeds: [embed], components, time: 1000 * 60 * 10, ephemeral: false, filter: i => i.user.id === interaction.user.id });
      if (!collector) return;
      collector.on('collect', async (btn) => {
        try {
          await btn.deferUpdate();
          const [, action] = btn.customId.split(':');
          if (action === 'farleft') { showHome = false; idx = 0; }
          else if (action === 'left') { showHome = false; idx = Math.max(0, idx - 1); }
          else if (action === 'home') { showHome = true; }
          else if (action === 'right') { showHome = false; idx = Math.min(total - 1, idx + 1); }
          else if (action === 'farright') { showHome = false; idx = total - 1; }

          let newEmbed;
          let newComponents;
          if (showHome) {
            newEmbed = buildHomeEmbed(links.general || links, articles[0], total);
            newComponents = buildRow(supportBuilders, true, total === 0);
          } else {
            newEmbed = renderArticleEmbed(articles[idx], idx, total);
            newComponents = buildRow(supportBuilders, idx === 0, idx === total - 1);
          }
          try { await message.edit({ embeds: [newEmbed], components: newComponents }); } catch (e) { /* ignore */ }
        } catch (e) {
          logger.warn('Error handling news button collect', { error: e && (e.stack || e) });
        }
      });
      collector.on('end', () => {
        // disable buttons after timeout
        (async () => {
          try {
            const disabled = buildRow(supportBuilders, true, true);
            await message.edit({ components: disabled });
          } catch (_) {}
        })();
      });
    } catch (err) {
      logger.error('Error in news command', { error: err && (err.stack || err) });
      try { await safeReply(interaction, { content: 'Failed showing news.' }, { loggerName: 'command:news' }); } catch (_) {}
    }
  },
};
