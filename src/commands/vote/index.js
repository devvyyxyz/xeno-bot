// `ActionRowBuilder` previously imported but not used — removed to satisfy linter
const { buildLinkButtons } = require('../../utils/buttonBuilder');
const { getCommandConfig } = require('../../utils/commandsConfig');
const links = require('../../../config/links.json');
const pageLinks = links.general || links;

const cmd = getCommandConfig('vote') || {
  name: 'vote',
  description: 'Vote for the bot on top.gg.'
};

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const rows = buildLinkButtons({ vote: pageLinks.vote }, { logger: console });

    // Try to fetch recent votes for this user from top.gg v1 and compute a streak
    const topggToken = process.env.TOPGG_TOKEN || process.env.TOPGG_API_TOKEN;
    const clientId = process.env.CLIENT_ID;

    async function fetchVotesForUser(discordId) {
      if (!topggToken || !clientId) return null;
      const https = require('https');

      // Try user-specific endpoint first: /v1/projects/{clientId}/votes/{user_id}
      const tryUserEndpoint = () => new Promise((resolve) => {
        try {
          const opts = {
            hostname: 'api.top.gg',
            path: `/v1/projects/${encodeURIComponent(clientId)}/votes/${encodeURIComponent(discordId)}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${topggToken}`, 'Accept': 'application/json' }
          };
          const req = https.request(opts, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (c) => raw += c);
            res.on('end', () => {
              if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
                try { resolve(JSON.parse(raw) || []); } catch (e) { resolve(null); }
              } else {
                resolve({ status: res.statusCode, body: raw });
              }
            });
          });
          req.on('error', () => resolve(null));
          req.end();
        } catch (e) { resolve(null); }
      });

      // Fallback: page through project votes and filter by user
      const pageVotesAndFilter = () => new Promise((resolve) => {
        try {
          const results = [];
          let cursor = undefined;
          const startDate = new Date(Date.now() - (1000 * 60 * 60 * 24 * 365)).toISOString();

          const pullPage = () => {
            const q = [];
            if (startDate) q.push(`startDate=${encodeURIComponent(startDate)}`);
            if (cursor) q.push(`cursor=${encodeURIComponent(cursor)}`);
            const path = `/v1/projects/${encodeURIComponent(clientId)}/votes${q.length ? `?${q.join('&')}` : ''}`;
            const opts = {
              hostname: 'api.top.gg',
              path,
              method: 'GET',
              headers: { 'Authorization': `Bearer ${topggToken}`, 'Accept': 'application/json' }
            };
            const req = https.request(opts, (res) => {
              let raw = '';
              res.setEncoding('utf8');
              res.on('data', (c) => raw += c);
              res.on('end', () => {
                try {
                  const parsed = raw ? JSON.parse(raw) : null;
                  const data = (parsed && parsed.data) ? parsed.data : (Array.isArray(parsed) ? parsed : []);
                  for (const v of data) {
                    if (v && v.user && (String(v.user.platform_id) === String(discordId) || String(v.user.id) === String(discordId))) results.push(v);
                  }
                  cursor = parsed && parsed.cursor;
                  if (cursor) {
                    // small safety to avoid huge pagination loops
                    if (results.length > 5000) return resolve(results);
                    return pullPage();
                  }
                  return resolve(results);
                } catch (e) { return resolve(null); }
              });
            });
            req.on('error', () => resolve(null));
            req.end();
          };
          pullPage();
        } catch (e) { resolve(null); }
      });

      const userRes = await tryUserEndpoint();
      if (userRes === null) return null;
      if (userRes && Array.isArray(userRes)) return userRes;
      if (userRes && userRes.status && userRes.status === 404) {
        // fallback to paging
        return await pageVotesAndFilter();
      }
      // Unexpected: try paging anyway
      return await pageVotesAndFilter();
    }

    // Compute streak from an array of vote objects (with created_at)
    function computeStreakFromVotes(votes) {
      if (!votes || !votes.length) return 0;
      const days = new Set(votes.map(v => {
        const d = new Date(v.created_at || v.data && v.data.created_at || v.date || null);
        if (isNaN(d)) return null;
        return d.toISOString().slice(0, 10);
      }).filter(Boolean));

      let streak = 0;
      const today = new Date();
      // use UTC date comparisons
      for (let i = 0; i < 365; i++) {
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        d.setUTCDate(d.getUTCDate() - i);
        const key = d.toISOString().slice(0, 10);
        if (days.has(key)) streak++; else break;
      }
      return streak;
    }

    let streakText = '';
    const discordId = interaction.user && interaction.user.id;
    if (discordId && (process.env.TOPGG_TOKEN || process.env.TOPGG_API_TOKEN) && clientId) {
      const userVotes = await fetchVotesForUser(discordId);
      if (userVotes === null) {
        streakText = '\n\n(Unable to fetch vote data from top.gg)';
      } else if (Array.isArray(userVotes)) {
        const streak = computeStreakFromVotes(userVotes);
        if (streak > 0) {
          streakText = `\n\nYou have a vote streak of **${streak}** day${streak === 1 ? '' : 's'}.`;
        } else {
          streakText = '\n\nNo recent votes found. Vote to start your streak!';
        }
      } else {
        streakText = '\n\n(Unexpected top.gg response)';
      }
    }

    await safeReply(interaction, { content: `Support the bot by voting!${streakText}`, components: rows, ephemeral: false }, { loggerName: 'command:vote' });
  }
};
