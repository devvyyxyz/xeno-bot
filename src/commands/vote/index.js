// `ActionRowBuilder` previously imported but not used — removed to satisfy linter
const { buildLinkButtons } = require('../../utils/buttonBuilder');
const { getCommandConfig } = require('../../utils/commandsConfig');
const links = require('../../../config/links.json');
const publicBotConfig = require('../../../config/bot.public.json');
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
    const https = require('https');

    // Check the current Top.gg vote status for this Discord user.
    // Prefer explicit status token, then public/deployment token, then legacy fallbacks.
    const topggToken =
      process.env.TOPGG_VOTE_STATUS_TOKEN ||
      process.env.TOPGG_PUBLIC_TOKEN ||
      process.env.TOPGG_TOKEN_PUBLIC ||
      process.env.TOPGG_TOKEN ||
      process.env.TOPGG_API_TOKEN;

    const expectedProjectPlatformId =
      process.env.TOPGG_VOTE_PROJECT_PLATFORM_ID ||
      process.env.PUBLIC_CLIENT_ID ||
      (publicBotConfig && publicBotConfig.clientId) ||
      null;

    function httpGetJson(path) {
      return new Promise((resolve) => {
        try {
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
              if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
                try { resolve(JSON.parse(raw) || null); } catch (e) { resolve(null); }
              } else {
                resolve({ status: res.statusCode, body: raw });
              }
            });
          });
          req.on('error', () => resolve(null));
          req.end();
        } catch (e) {
          resolve(null);
        }
      });
    }

    async function fetchCurrentProject() {
      if (!topggToken) return null;
      return await httpGetJson('/v1/projects/@me');
    }

    async function fetchVoteStatus(discordId) {
      if (!topggToken || !discordId) return null;

      const tryStatusEndpoint = (useSourceParam) => new Promise((resolve) => {
        try {
          const query = useSourceParam ? '?source=discord' : '';
          const opts = {
            hostname: 'api.top.gg',
            path: `/v1/projects/@me/votes/${encodeURIComponent(discordId)}${query}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${topggToken}`, 'Accept': 'application/json' }
          };
          const req = https.request(opts, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (c) => raw += c);
            res.on('end', () => {
              if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
                try { resolve(JSON.parse(raw) || null); } catch (e) { resolve(null); }
              } else {
                resolve({ status: res.statusCode, body: raw });
              }
            });
          });
          req.on('error', () => resolve(null));
          req.end();
        } catch (e) { resolve(null); }
      });

      const direct = await tryStatusEndpoint(true);
      if (direct && direct.status && direct.status !== 404 && direct.status !== 400) return direct;
      if (direct && typeof direct === 'object' && !direct.status) return direct;

      const fallback = await tryStatusEndpoint(false);
      if (fallback && fallback.status && fallback.status !== 404 && fallback.status !== 400) return fallback;
      if (fallback && typeof fallback === 'object' && !fallback.status) return fallback;
      return fallback;
    }

    async function fetchRecentVoteByHistory(discordId) {
      if (!topggToken || !discordId) return null;
      const https = require('https');
      const startDate = new Date(Date.now() - (1000 * 60 * 60 * 48)).toISOString();

      return await new Promise((resolve) => {
        try {
          const path = `/v1/projects/@me/votes?startDate=${encodeURIComponent(startDate)}`;
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
                if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) return resolve(null);
                const parsed = raw ? JSON.parse(raw) : null;
                const list = Array.isArray(parsed?.data) ? parsed.data : [];
                const match = list.find((v) => String(v?.platform_id || v?.user_id || '') === String(discordId));
                if (!match) return resolve(null);

                const createdAt = new Date(match.created_at || null);
                const expiresAt = new Date(match.expires_at || null);
                if (isNaN(createdAt)) return resolve(null);

                resolve({
                  voted: !isNaN(expiresAt) ? Date.now() < expiresAt.getTime() : true,
                  createdAt: createdAt.getTime(),
                  expiresAt: !isNaN(expiresAt) ? expiresAt.getTime() : null,
                  weight: Number(match.weight || 1),
                });
              } catch (_) {
                resolve(null);
              }
            });
          });
          req.on('error', () => resolve(null));
          req.end();
        } catch (_) {
          resolve(null);
        }
      });
    }

    function formatVoteStatus(status) {
      if (!status) return null;
      if (status.status) return status;
      if (!status.created_at || !status.expires_at) return null;

      const createdAt = new Date(status.created_at);
      const expiresAt = new Date(status.expires_at);
      if (isNaN(createdAt) || isNaN(expiresAt)) return null;

      return {
        voted: Date.now() < expiresAt.getTime(),
        createdAt: createdAt.getTime(),
        expiresAt: expiresAt.getTime(),
        weight: Number(status.weight || 1),
      };
    }

    let voteStatusText = '';
    const discordId = interaction.user && interaction.user.id;
    if (!topggToken) {
      voteStatusText = '\n\n(Vote status is unavailable: no Top.gg status token configured.)';
    } else if (discordId) {
      const project = await fetchCurrentProject();
      const tokenProjectPlatformId =
        project && !project.status && project.platform_id ? String(project.platform_id) : null;
      if (
        expectedProjectPlatformId &&
        tokenProjectPlatformId &&
        String(expectedProjectPlatformId) !== tokenProjectPlatformId
      ) {
        voteStatusText = '\n\n(Vote status is unavailable: Top.gg token points to a different bot project than production.)';
        await safeReply(interaction, { content: `Support the bot by voting!${voteStatusText}`, components: rows, ephemeral: false }, { loggerName: 'command:vote' });
        return;
      }

      const status = await fetchVoteStatus(discordId);
      if (status === null) {
        voteStatusText = '\n\n(Unable to fetch vote status from top.gg)';
      } else if (status.status === 404) {
        const history = await fetchRecentVoteByHistory(discordId);
        if (history && history.voted && history.expiresAt) {
          voteStatusText = `\n\nYou have voted recently. You can vote again <t:${Math.floor(history.expiresAt / 1000)}:R>.`;
        } else if (history) {
          voteStatusText = '\n\nYou voted recently, but your vote window has expired. Vote again to support the bot!';
        } else {
          voteStatusText = '\n\nYou have not voted recently. Vote now to support the bot!';
        }
      } else if (status.status && status.status >= 400) {
        const history = await fetchRecentVoteByHistory(discordId);
        if (history && history.voted && history.expiresAt) {
          voteStatusText = `\n\nYou have voted recently. You can vote again <t:${Math.floor(history.expiresAt / 1000)}:R>.`;
        } else {
          voteStatusText = '\n\n(Top.gg vote status lookup failed)';
        }
      } else {
        const normalized = formatVoteStatus(status);
        if (normalized && normalized.voted) {
          voteStatusText = `\n\nYou have voted recently. You can vote again <t:${Math.floor(normalized.expiresAt / 1000)}:R>.`;
        } else if (normalized) {
          voteStatusText = '\n\nYou do not currently have an active vote on record. Vote now to support the bot!';
        } else {
          voteStatusText = '\n\n(Unexpected top.gg response)';
        }
      }
    }

    await safeReply(interaction, { content: `Support the bot by voting!${voteStatusText}`, components: rows, ephemeral: false }, { loggerName: 'command:vote' });
  }
};
