const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger').get('command:news');
const links = require('../../../config/links.json');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, PrimaryButtonBuilder, SecondaryButtonBuilder, ButtonStyle, SectionBuilder } = require('discord.js');
const safeReply = require('../../utils/safeReply');
const userModel = require('../../models/user');
const articlesUtil = require('../../utils/articles');
const createInteractionCollector = require('../../utils/collectorHelper');

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

function extractArticleTitleAndBody(article) {
  const lines = article.split(/\r?\n/).map(l => l.trim());
  let title = null;
  for (const l of lines) {
    if (!l) continue;
    const m = l.match(/^#{1,2}\s+(.+)$/);
    if (m) { title = m[1]; break; }
    title = l; break;
  }
  const body = article.replace(/^#{1,2}\s+.*$/m, '').trim();
  return { title: title || 'Article', body };
}

function buildNewsV2Components({
  title = 'News',
  description = 'No data.',
  showNavigation = false,
  disabledLeft = false,
  disabledRight = false,
  showCategories = false,
  categories = [],
  expired = false,
  avatarUrl = null
}) {
  const container = new ContainerBuilder();
  
  // Add title with optional avatar
  const safeTitle = String(title || 'News').trim();
  const titleText = safeTitle.startsWith('##') ? safeTitle : `## ${safeTitle}`;
  if (avatarUrl) {
    try {
      const section = new SectionBuilder();
      if (typeof section.setThumbnailAccessory === 'function') {
        section
          .setThumbnailAccessory((thumbnail) => {
            if (thumbnail && typeof thumbnail.setURL === 'function') thumbnail.setURL(avatarUrl);
            return thumbnail;
          })
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
      }
    } catch (_) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description && String(description).trim().length ? String(description) : 'No articles available.'));

  if (!expired) {
    // Category buttons (for home view)
    if (showCategories && Array.isArray(categories) && categories.length > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      );
      const categoryRow = new ActionRowBuilder();
      for (const cat of categories.slice(0, 5)) {
        const label = String(cat).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        categoryRow.addComponents(
          new PrimaryButtonBuilder()
            .setCustomId(`news:cat:${cat}`)
            .setLabel(label)
        );
      }
      container.addActionRowComponents(categoryRow);
    }

    // Navigation buttons (for article view)
    if (showNavigation) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      );
      const navRow = new ActionRowBuilder();
      const navButtons = [
        { id: 'farleft', label: '<<', disabled: disabledLeft },
        { id: 'left', label: '<', disabled: disabledLeft },
        { id: 'home', label: 'Home', disabled: false },
        { id: 'right', label: '>', disabled: disabledRight },
        { id: 'farright', label: '>>', disabled: disabledRight }
      ];
      for (const btn of navButtons) {
        navRow.addComponents(
          new SecondaryButtonBuilder()
            .setCustomId(`news:${btn.id}`)
            .setLabel(btn.label)
            .setDisabled(btn.disabled)
        );
      }
      container.addActionRowComponents(navRow);
    }
  }

  return [container];
}

function buildArticleV2(article, index, total, avatarUrl) {
  const { title, body } = extractArticleTitleAndBody(article);
  const truncated = body && body.length > 3000 ? body.slice(0, 2997) + '...' : (body || 'No content');
  const description = `**${title}**\n\n${truncated}\n\n_Article ${index + 1} of ${total}_`;

  return buildNewsV2Components({
    title: '📢 News',
    description,
    showNavigation: true,
    disabledLeft: index === 0,
    disabledRight: index === total - 1,
    expired: false,
    avatarUrl
  });
}

function buildHomeV2(linksObj, latestArticle, categories, avatarUrl) {
  const pageLinks = linksObj || {};
  let description = "Welcome to the Xeno Bot news hub — read the latest updates, find quick links, and browse recent articles.\n\n";

  // Quick Links section
  try {
    const keys = Object.keys(pageLinks || {});
    if (!keys || keys.length === 0) {
      description += "Quick Links\n_No quick links configured._\n\n";
    } else {
      const values = Object.values(pageLinks || {});
      const isFlat = values.length > 0 && values.every(v => typeof v === 'string');
      if (isFlat) {
        // Render flat quick links
        description += "**Quick Links**\n";
        for (const [key, url] of Object.entries(pageLinks)) {
          try {
            if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
              const label = String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              description += `• [${label}](${url})\n`;
            }
          } catch (e) { /* ignore malformed */ }
        }
        description += "\n";
      } else {
        // Render categorized quick links
        for (const cat of keys) {
          const items = pageLinks[cat] || {};
          const displayCat = String(cat).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          description += `**Quick Links — ${displayCat}**\n`;
          for (const [key, url] of Object.entries(items)) {
            try {
              if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                const label = String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                description += `• [${label}](${url})\n`;
              }
            } catch (e) { /* ignore malformed */ }
          }
        }
        description += "\n";
      }
    }
  } catch (e) {
    description += "Quick Links\n_Failed to load quick links._\n\n";
  }

  // Latest article preview
  if (latestArticle) {
    const { title, body } = extractArticleTitleAndBody(latestArticle);
    const safeBody = body && body.length > 800 ? body.slice(0, 797) + '...' : (body || 'No content');
    description += `**Latest Article — ${title}**\n${safeBody}`;
  } else {
    description += "**Latest Article**\n_No articles available._";
  }

  return buildNewsV2Components({
    title: '📢 News',
    description,
    showCategories: true,
    categories,
    expired: false,
    avatarUrl
  });
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

      const botAvatar = interaction && interaction.client && interaction.client.user ? interaction.client.user.displayAvatarURL({ size: 256, extension: 'png' }) : null;
      const categoryKeys = Object.keys(articlesByCategory).length ? Object.keys(articlesByCategory) : ['release','events','newsletter','other'];

      // Mark latest article as read for this user when they open /news
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

      // Build home view
      const components = buildHomeV2(links.general || links, null, categoryKeys, botAvatar);

      await safeReply(interaction, { components, flags: MessageFlags.IsComponentsV2, ephemeral: false }, { loggerName: 'command:news' });
      
      const { collector, message } = await createInteractionCollector(interaction, { components: [], time: 1000 * 60 * 10 });
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
              const emptyComponents = buildNewsV2Components({
                title: '📢 News',
                description: `_No articles in ${cat}._`,
                expired: false,
                avatarUrl: botAvatar
              });
              try { await btn.editReply({ components: emptyComponents, flags: MessageFlags.IsComponentsV2 }); } catch (_) {}
              return;
            }
            articles = catArticles;
            const newComponents = buildArticleV2(articles[idx], idx, total, botAvatar);
            try { await btn.editReply({ components: newComponents, flags: MessageFlags.IsComponentsV2 }); } catch (_) {}
            return;
          }

          if (action === 'farleft') { showHome = false; idx = 0; }
          else if (action === 'left') { showHome = false; idx = Math.max(0, idx - 1); }
          else if (action === 'home') { showHome = true; }
          else if (action === 'right') { showHome = false; idx = Math.min(total - 1, idx + 1); }
          else if (action === 'farright') { showHome = false; idx = total - 1; }

          let newComponents;
          if (showHome) {
            newComponents = buildHomeV2(links.general || links, null, categoryKeys, botAvatar);
          } else {
            newComponents = buildArticleV2(articles[idx], idx, total, botAvatar);
          }
          try { await btn.editReply({ components: newComponents, flags: MessageFlags.IsComponentsV2 }); } catch (e) { /* ignore */ }
        } catch (e) {
          logger.warn('Error handling news button collect', { error: e && (e.stack || e) });
        }
      });

      collector.on('end', () => {
        // V2 components don't support traditional disable states via message.edit()
        // so we skip the end handler for now
      });
    } catch (err) {
      logger.error('Error in news command', { error: err && (err.stack || err) });
      try { await safeReply(interaction, { content: 'Failed showing news.' }, { loggerName: 'command:news' }); } catch (_) {}
    }
  },
};
