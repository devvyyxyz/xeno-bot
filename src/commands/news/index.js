const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger').get('command:news');
const links = require('../../../config/links.json');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const safeReply = require('../../utils/safeReply');
const userModel = require('../../models/user');
const articlesUtil = require('../../utils/articles');

const ARTICLES_DIR = path.join(__dirname, '..', '..', '..', 'config', 'articles');

function loadArticlesByCategory() {
  const out = {};
  try {
    if (!fs.existsSync(ARTICLES_DIR)) return out;
    const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const key = path.basename(f, '.md');
      try {
        const raw = fs.readFileSync(path.join(ARTICLES_DIR, f), 'utf8');
        // split on a line of 3+ dashes, tolerant of CRLF and surrounding blank lines
        let parts = raw.split(/(?:\r?\n){0,2}-{3,}(?:\r?\n){0,2}/).map(s => s.trim()).filter(Boolean);
        // If any part contains multiple H2 sections (##), split them further so each is its own article
        const expanded = [];
        for (const p of parts) {
          if (/^##\s+/m.test(p)) {
            const sub = p.split(/(?=^##\s)/m).map(s => s.trim()).filter(Boolean);
            expanded.push(...sub);
          } else {
            expanded.push(p);
          }
        }
        parts = expanded;
        // If no explicit separators found, try splitting by top-level headings (H1/H2)
        if (parts.length <= 1) {
          const headingParts = raw.split(/(?=^#{1,2}\s)/m).map(s => s.trim()).filter(Boolean);
          if (headingParts.length > 1) {
            // If the first part is a top-level H1 intro (e.g., "# Version History"), drop it
            if (headingParts[0].match(/^#\s+/) && headingParts.length > 1) {
              headingParts.shift();
            }
            parts = headingParts;
          }
        }
        // If the first part looks like a top-level intro (starts with # ), drop it
        if (parts.length > 0 && parts[0].match(/^#\s+/)) {
          parts.shift();
        }
        out[key] = parts;
      } catch (e) {
        out[key] = [];
      }
    }
  } catch (e) {
    logger.warn('Failed loading articles by category', { error: e && (e.stack || e) });
  }
  return out;
}

function renderArticleEmbed(article, index, total) {
  // Fallback article renderer (keeps backward compatibility)
  const { title, body } = (function extract(articleText) {
    const lines = articleText.split(/\r?\n/).map(l => l.trim());
    let t = null;
    for (const l of lines) {
      if (!l) continue;
      const m = l.match(/^#{1,2}\s+(.+)$/);
      if (m) { t = m[1]; break; }
      t = l; break;
    }
    const b = articleText.replace(/^#{1,2}\s+.*$/m, '').trim();
    const trunc = b.length > 3000 ? b.slice(0, 3000) + '\n\n*...truncated*' : b;
    return { title: t || `News #${index + 1}`, body: trunc };
  })(article);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(body || 'No content')
    .setFooter({ text: `Article ${index + 1} of ${total}` })
    .setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d)
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
      // Load all articles by category
      const articlesByCategory = loadArticlesByCategory();
      // Check if any articles exist
      let anyCount = 0;
      for (const k of Object.keys(articlesByCategory)) anyCount += (articlesByCategory[k] || []).length;
      if (!anyCount) {
        await safeReply(interaction, { content: 'No news articles available.', ephemeral: true }, { loggerName: 'command:news' });
        return;
      }

      // Start on the Home page view
      let idx = 0;
      let showHome = true;
      let articles = [];
      let total = 0;
      let currentCategory = null;
      const supportBuilders = (() => {
        try { const { ButtonBuilder } = require('discord.js'); return typeof ButtonBuilder === 'function'; } catch (_) { return false; }
      })();

      // Build a home embed that shows introduction, quick links, and latest article
      function extractTitleAndBody(article) {
        const lines = article.split(/\r?\n/).map(l => l.trim());
        let title = null;
        for (const l of lines) {
          if (!l) continue;
          const m = l.match(/^#{1,2}\s+(.+)$/);
          if (m) { title = m[1]; break; }
          title = l; break;
        }
        const body = article.replace(/^#{1,2}\s+.*$/m, '').trim();
        const truncated = body.length > 900 ? body.slice(0, 900) + '\n\n*...truncated*' : body;
        return { title: title || 'Latest Article', body: truncated };
      }

      function buildHomeEmbed(linksObj, latestArticle, totalCount, avatarUrl) {
        const pageLinks = linksObj || {};
        const embed = new EmbedBuilder()
          .setTitle('📢 News')
          .setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d)
          .setTimestamp();
        if (avatarUrl) embed.setThumbnail(avatarUrl);

        // Introduction
        embed.addFields({ name: 'Introduction', value: "Welcome to the Xeno Bot news hub — read the latest updates, find quick links, and browse recent articles.", inline: false });

        // Quick Links: support either a flat map (key -> url) or categorized map (category -> { key -> url })
        try {
          const keys = Object.keys(pageLinks || {});
          if (!keys || keys.length === 0) {
            embed.addFields({ name: 'Quick Links', value: 'No quick links configured.', inline: false });
          } else {
            const values = Object.values(pageLinks || {});
            const isFlat = values.length > 0 && values.every(v => typeof v === 'string');
            if (isFlat) {
              // Render a single Quick Links field listing each key -> url
              let value = '';
              for (const [key, url] of Object.entries(pageLinks)) {
                try {
                  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                    const label = String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    value += `• [${label}](${url})\n`;
                  }
                } catch (e) { /* ignore malformed */ }
              }
              embed.addFields({ name: 'Quick Links', value: value.trim() || 'No quick links configured.', inline: false });
            } else {
              // Categorized: one field per category
              for (const cat of keys) {
                const items = pageLinks[cat] || {};
                const displayCat = String(cat).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                let value = '';
                for (const [key, url] of Object.entries(items)) {
                  try {
                    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                      const label = String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                      value += `• [${label}](${url})\n`;
                    }
                  } catch (e) { /* ignore malformed */ }
                }
                if (!value) value = 'No links configured for this category.';
                embed.addFields({ name: `Quick Links — ${displayCat}`, value: value.trim(), inline: false });
              }
            }
          }
        } catch (e) {
          embed.addFields({ name: 'Quick Links', value: 'Failed to load quick links.', inline: false });
        }

        // Latest article preview (single field with title)
        if (latestArticle) {
          const { title, body } = extractTitleAndBody(latestArticle);
          const safeBody = body && body.length > 1024 ? body.slice(0, 1021) + '...' : (body || 'No content');
          embed.addFields({ name: `Latest Article — ${title}`, value: safeBody, inline: false });
        } else {
          embed.addFields({ name: 'Latest Article', value: 'No articles available.', inline: false });
        }

        return embed;
      }

      const botAvatar = interaction && interaction.client && interaction.client.user ? interaction.client.user.displayAvatarURL({ size: 512, extension: 'png' }) : null;
      const categoryKeys = Object.keys(articlesByCategory).length ? Object.keys(articlesByCategory) : ['release','events','newsletter','other'];

      // helper to build category selector row
      function buildCategoryRow(supportBuilders, categories) {
        if (!categories || categories.length === 0) return [];
        if (supportBuilders) {
          const { ActionRowBuilder, ButtonBuilder } = require('discord.js');
          const row = new ActionRowBuilder();
          for (const k of categories.slice(0, 5)) {
            const label = String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            row.addComponents(new ButtonBuilder().setCustomId(`news:cat:${k}`).setLabel(label).setStyle(ButtonStyle.Primary));
          }
          return [row];
        }
        const comps = categories.slice(0, 5).map(k => ({ type: 2, style: 1, custom_id: `news:cat:${k}`, label: String(k) }));
        return [{ type: 1, components: comps }];
      }

      // Determine initial latest article: use newest file's last article section
      let firstArticle = null;
      try {
        firstArticle = articlesUtil.getLatestArticleContent();
      } catch (e) { firstArticle = null; }

      const embed = buildHomeEmbed(links.general || links, firstArticle, 0, botAvatar);
      // Mark latest article as read for this user when they open /news so the reminder stops showing
      try {
        const latestInfo = articlesUtil.getLatestArticleInfo();
        if (latestInfo && latestInfo.latest) {
          const u = await userModel.getUserByDiscordId(interaction.user.id);
          if (u) {
            const data = u.data || {};
            data.meta = data.meta || {};
            data.meta.lastReadArticleAt = latestInfo.latest;
            await userModel.updateUserDataRawById(u.id, data);
          }
        }
      } catch (e) { try { logger.warn('Failed marking article as read for user', { error: e && (e.stack || e) }); } catch (_) {} }
      const categoryRow = buildCategoryRow(supportBuilders, categoryKeys);
      const navRow = buildRow(supportBuilders, true, true);
      // Home page: only show category buttons (no navigation/home row)
      const components = categoryRow;

      const createCollector = require('../../utils/collectorHelper');
      const { collector, message } = await createCollector(interaction, { embeds: [embed], components, time: 1000 * 60 * 10, ephemeral: false, filter: i => i.user.id === interaction.user.id });
      if (!collector) return;
      collector.on('collect', async (btn) => {
        try {
          await btn.deferUpdate();
          const parts = btn.customId.split(':');
          const action = parts[1];
          const param = parts[2];
          if (action === 'cat' && param) {
            // open category
            const cat = param;
            const catArticles = articlesByCategory[cat] || [];
            showHome = false;
            idx = 0;
            total = catArticles.length;
            if (total === 0) {
              const emptyEmbed = new EmbedBuilder().setTitle(`No articles in ${cat}`).setDescription('No articles found.').setColor(require('../../utils/commandsConfig').getCommandsObject().colour || 0xbab25d);
              try { await message.edit({ embeds: [emptyEmbed], components: buildRow(supportBuilders, true, true) }); } catch (_) {}
              return;
            }
            // set current articles into a temporary variable by reassigning articles
            articles = catArticles;
            const art = renderArticleEmbed(articles[idx], idx, total);
            try { await message.edit({ embeds: [art], components: buildRow(supportBuilders, idx === 0, idx === total - 1) }); } catch (_) {}
            return;
          }
          if (action === 'farleft') { showHome = false; idx = 0; }
          else if (action === 'left') { showHome = false; idx = Math.max(0, idx - 1); }
          else if (action === 'home') { showHome = true; }
          else if (action === 'right') { showHome = false; idx = Math.min(total - 1, idx + 1); }
          else if (action === 'farright') { showHome = false; idx = total - 1; }

          let newEmbed;
          let newComponents;
          if (showHome) {
            newEmbed = buildHomeEmbed(links.general || links, firstArticle, 0, botAvatar);
            // Home view should only contain category buttons
            newComponents = categoryRow;
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
