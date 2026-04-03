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

    // Check the current Top.gg vote status for this Discord user.
    // Prefer explicit status token, then public/deployment token, then legacy fallbacks.
    const topggToken =
      process.env.TOPGG_VOTE_STATUS_TOKEN ||
      process.env.TOPGG_PUBLIC_TOKEN ||
      process.env.TOPGG_TOKEN_PUBLIC ||
      process.env.TOPGG_TOKEN ||
      process.env.TOPGG_API_TOKEN;
    async function fetchVoteStatus(discordId) {
      if (!topggToken || !discordId) return null;
      const https = require('https');

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
      const status = await fetchVoteStatus(discordId);
      if (status === null) {
        voteStatusText = '\n\n(Unable to fetch vote status from top.gg)';
      } else if (status.status === 404) {
        voteStatusText = '\n\nYou have not voted recently. Vote now to support the bot!';
      } else if (status.status && status.status >= 400) {
        voteStatusText = '\n\n(Top.gg vote status lookup failed)';
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
