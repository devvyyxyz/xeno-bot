const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const cors = require('cors');
const { URLSearchParams } = require('url');

const guildModel = require('../src/models/guild');
const db = require('../src/db');
const knex = db.knex;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const CALLBACK_URL = process.env.DISCORD_OAUTH_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback';
const SESSION_SECRET = process.env.SESSION_SECRET || 'please-change-this';
const PORT = process.env.DASHBOARD_PORT || process.env.PORT || 3000;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
  console.warn('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET not set — OAuth will not work until provided');
}

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
// Persist sessions to disk so login survives process restarts during development
// Try to use a DB-backed session store if possible (safer than file-based storage)
class KnexStore extends session.Store {
  constructor(opts = {}) {
    super();
    this.knex = opts.knex;
    this.table = opts.table || 'sessions';
  }

  async get(sid, cb) {
    try {
      const row = await this.knex(this.table).where({ sid }).first();
      if (!row) return cb(null, null);
      const sess = JSON.parse(row.sess);
      return cb(null, sess);
    } catch (e) {
      return cb(e);
    }
  }

  async set(sid, sess, cb) {
    try {
      const expires = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : null;
      const payload = { sid, sess: JSON.stringify(sess), expires };
      const exists = await this.knex(this.table).where({ sid }).first();
      if (exists) await this.knex(this.table).where({ sid }).update(payload);
      else await this.knex(this.table).insert(payload);
      return cb && cb();
    } catch (e) {
      return cb && cb(e);
    }
  }

  async destroy(sid, cb) {
    try {
      await this.knex(this.table).where({ sid }).del();
      return cb && cb();
    } catch (e) {
      return cb && cb(e);
    }
  }
}

let sessionStore;
try {
  // Ensure DB migrations ran (creates sessions table if missing)
  db.migrate().catch(() => {});
  sessionStore = new KnexStore({ knex, table: 'sessions' });
} catch (e) {
  // Fallback to file store if DB not available
  console.warn('DB session store unavailable, falling back to file store', e && (e.stack || e));
  sessionStore = new FileStore({ path: path.join(__dirname, 'sessions'), retries: 1 });
}

app.use(session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'unauthenticated' });
}

app.use('/', express.static(path.join(__dirname, 'public')));

// Serve dashboard page directly and provide a simple invite redirect
app.get('/dashboard', (req, res) => {
  // require authentication to view the dashboard page; redirect to OAuth if not logged in
  if (!req.session || !req.session.user) {
    if (req.session) {
      req.session.returnTo = '/dashboard';
      return req.session.save(() => res.redirect('/auth/discord'));
    }
    return res.redirect('/auth/discord');
  }
  return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/invite', (req, res) => {
  if (!DISCORD_CLIENT_ID) return res.status(500).send('DISCORD_CLIENT_ID not configured');
  const perms = 0; // no extra permissions by default
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&scope=bot%20applications.commands&permissions=${perms}`;
  return res.redirect(inviteUrl);
});

app.get('/auth/discord', (req, res) => {
  const returnTo = req.query.returnTo;
  if (returnTo && req.session) {
    req.session.returnTo = returnTo;
    // ensure session saved before redirecting to Discord
    return req.session.save(() => {
      const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID || '',
        redirect_uri: CALLBACK_URL,
        response_type: 'code',
        scope: 'identify guilds'
      });
      return res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    });
  }

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID || '',
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: 'identify guilds'
  });
  return res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/');
  try {
    const params = new URLSearchParams();
    params.append('client_id', DISCORD_CLIENT_ID);
    params.append('client_secret', DISCORD_CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', CALLBACK_URL);

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!tokenRes.ok) return res.redirect('/');
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    // fetch user and guilds
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!userRes.ok) return res.redirect('/');
    const user = await userRes.json();
    const guilds = guildsRes.ok ? await guildsRes.json() : [];
    // Persist user (without access token) to DB for later reference — do not store tokens in plain text here.
    try {
      const payload = { discord_id: String(user.id), data: JSON.stringify({ username: user.username, discriminator: user.discriminator, guilds }) };
      const existing = await knex('users').where({ discord_id: String(user.id) }).first();
      if (existing) await knex('users').where({ discord_id: String(user.id) }).update({ data: payload.data, updated_at: knex.fn.now() });
      else await knex('users').insert(payload);
    } catch (e) {
      console.warn('Failed to upsert user row', e && (e.stack || e));
    }
    // Store session user (do not keep accessToken long-term)
    req.session.user = { id: user.id, username: user.username, discriminator: user.discriminator, guilds };
    // ensure session is saved before redirecting so the browser receives the cookie
    req.session.save((saveErr) => {
      if (saveErr) console.error('Session save error', saveErr && (saveErr.stack || saveErr));
      console.log('OAuth login completed for user', user.id);
      const dest = (req.session && req.session.returnTo) ? req.session.returnTo : '/';
      // clear returnTo so it doesn't affect future logins
      try { delete req.session.returnTo; } catch (e) { /* ignore */ }
      return res.redirect(dest);
    });
  } catch (e) {
    console.error('OAuth callback error', e && (e.stack || e));
    return res.redirect('/');
  }
});

app.get('/logout', (req, res) => {
  try { req.session.destroy(() => {}); } catch (e) { /* ignore */ }
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  const has = !!(req.session && req.session.user);
  console.log('/api/me called — session present:', has, 'userId:', req.session && req.session.user && req.session.user.id);
  if (!has) return res.status(200).json({ authenticated: false });
  const u = req.session.user;
  return res.json({ authenticated: true, user: { id: u.id, username: u.username, discriminator: u.discriminator } });
});

// DEBUG: expose session contents (temporary)
app.get('/debug/session', (req, res) => {
  try {
    return res.json({ session: req.session || null, cookies: req.headers.cookie || null });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.get('/api/guilds', ensureAuth, (req, res) => {
  const guilds = (req.session && req.session.user && req.session.user.guilds) || [];
  // Use BigInt to safely test permission bits for large permission values
  const managed = guilds.filter(g => {
    try {
      const permSource = (g.permissions != null) ? g.permissions : '0';
      const perms = typeof permSource === 'bigint' ? permSource : BigInt(String(permSource || '0'));
      const isAdmin = (perms & 0x8n) === 0x8n;
      const canManageGuild = (perms & 0x20n) === 0x20n;
      return isAdmin || canManageGuild;
    } catch (e) {
      console.warn('Permission parse error for guild', g && g.id, e && e.message);
      return false;
    }
  }).map(g => ({ id: g.id, name: g.name, permissions: g.permissions }));
  // Prefer using cached bot guilds (populated by the bot). Fall back to direct Bot token checks if necessary.
  (async () => {
    try {
      const BOT_TOKEN = process.env.BOT_TOKEN;
      const CACHE_TTL = Number(process.env.BOT_GUILD_CACHE_TTL_MS || 1000 * 60 * 5); // 5 minutes default
      // load cached bot guild ids
      let cached = [];
      try {
        const rows = await knex('bot_guilds').select('guild_id', 'cached_at');
        const now = Date.now();
        cached = rows.filter(r => (now - Number(r.cached_at)) <= CACHE_TTL).map(r => String(r.guild_id));
      } catch (e) {
        // ignore if table doesn't exist yet or DB not available
        cached = [];
      }

      let final = managed;
      if (cached && cached.length > 0) {
        final = managed.filter(g => cached.includes(String(g.id)));
      } else if (BOT_TOKEN) {
        // perform parallel checks and populate cache for future requests
        const checks = await Promise.all(managed.map(async (g) => {
          try {
            const r = await fetch(`https://discord.com/api/v10/guilds/${g.id}`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
            if (r.ok) {
              // upsert into cache
              try {
                const now = Date.now();
                const exists = await knex('bot_guilds').where({ guild_id: String(g.id) }).first();
                if (exists) await knex('bot_guilds').where({ guild_id: String(g.id) }).update({ cached_at: now, updated_at: knex.fn.now() });
                else await knex('bot_guilds').insert({ guild_id: String(g.id), cached_at: now });
              } catch (e) {
                // ignore cache write errors
                console.warn('Failed to upsert bot_guilds cache', e && (e.stack || e));
              }
              return g;
            }
            return null;
          } catch (e) {
            return null;
          }
        }));
        final = checks.filter(Boolean);
      } else {
        // no BOT_TOKEN and no cache — return managed list (may include guilds the bot isn't in)
        final = managed;
      }

      console.log('/api/guilds — total:', guilds.length, 'managed:', managed.length, 'final:', final.length);
      return res.json({ guilds: final, raw: guilds });
    } catch (e) {
      console.error('Error filtering guilds by bot presence', e && (e.stack || e));
      return res.json({ guilds: managed, raw: guilds });
    }
  })();
});

// Internal endpoint for the bot to POST the list of guild ids it is in.
// Protect with BOT_GUILD_SECRET env var if set.
app.post('/internal/bot_guilds', async (req, res) => {
  const secret = process.env.BOT_GUILD_SECRET;
  if (secret) {
    const provided = req.headers['x-bot-guild-secret'] || (req.body && req.body.secret);
    if (!provided || provided !== secret) return res.status(403).json({ error: 'forbidden' });
  }
  const ids = Array.isArray(req.body) ? req.body : (req.body && req.body.guilds) || [];
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'invalid_payload' });
  try {
    const now = Date.now();
    // replace cache entirely in a transaction for simplicity
    await knex.transaction(async (trx) => {
      // delete any guilds not in the incoming set
      await trx('bot_guilds').whereNotIn('guild_id', ids.map(String)).del();
      // upsert incoming ids
      for (const gid of ids) {
        const existing = await trx('bot_guilds').where({ guild_id: String(gid) }).first();
        if (existing) await trx('bot_guilds').where({ guild_id: String(gid) }).update({ cached_at: now, updated_at: knex.fn.now() });
        else await trx('bot_guilds').insert({ guild_id: String(gid), cached_at: now });
      }
    });
    return res.json({ ok: true, count: ids.length });
  } catch (e) {
    console.error('Failed to update bot_guilds', e && (e.stack || e));
    return res.status(500).json({ error: 'db_error' });
  }
});

app.get('/internal/bot_guilds', async (req, res) => {
  try {
    const rows = await knex('bot_guilds').select('guild_id', 'cached_at');
    return res.json({ guilds: rows.map(r => ({ guild_id: r.guild_id, cached_at: r.cached_at })) });
  } catch (e) {
    return res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/guilds/:id/settings', ensureAuth, async (req, res) => {
  const guildId = req.params.id;
  const found = (req.session.user.guilds || []).find(g => g.id === guildId);
  if (!found) return res.status(403).json({ error: 'forbidden' });
  const perms = Number(found.permissions || 0);
  if (!((perms & 0x8) === 0x8 || (perms & 0x20) === 0x20)) return res.status(403).json({ error: 'insufficient_permissions' });
  try {
    const cfg = await guildModel.getGuildConfig(guildId);
    return res.json({ config: cfg || null });
  } catch (e) {
    return res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/guilds/:id/settings', ensureAuth, async (req, res) => {
  const guildId = req.params.id;
  const found = (req.session.user.guilds || []).find(g => g.id === guildId);
  if (!found) return res.status(403).json({ error: 'forbidden' });
  const perms = Number(found.permissions || 0);
  if (!((perms & 0x8) === 0x8 || (perms & 0x20) === 0x20)) return res.status(403).json({ error: 'insufficient_permissions' });
  const body = req.body || {};
  try {
    const existing = await guildModel.getGuildConfig(guildId);
    const data = (existing && existing.data) ? existing.data : {};
    if ('delete_spawn_message' in body) data.delete_spawn_message = !!body.delete_spawn_message;
    const updated = await guildModel.upsertGuildConfig(guildId, { data });
    return res.json({ config: updated });
  } catch (e) {
    return res.status(500).json({ error: 'db_error' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Dashboard listening on port ${PORT}`);
});

module.exports = app;
