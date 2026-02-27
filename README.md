# xeno-bot — discord.js v14 scaffold

Scalable, minimal Discord bot project layout using discord.js v14.

Remote logging transport (Papertrail): set `PAPERTRAIL_HOST` and `PAPERTRAIL_PORT` in `.env` to forward logs to Papertrail. The logger will automatically use the configured transport when present.

Quick start
# xeno-bot — discord.js v14 scaffold

Scalable, minimal Discord bot project layout using discord.js v14.

Quick start

1. Copy `.env.example` → `.env` and fill values (`TOKEN`, `CLIENT_ID`, optional `GUILD_ID`).
2. Install dependencies:

```bash
npm install
```

3. (Optional) Deploy slash commands to a guild for fast testing:

```bash
npm run deploy-commands
```

4. Run the bot:

Production (public bot):

```bash
npm start
```

Development (private/dev bot):

```bash
npm run start:dev
```

Development

- `npm run dev` — run with `nodemon` and auto-restart on changes.
- Commands live in `src/commands` and should export `name`, `description`, `data`, and `executeInteraction` / `executeMessage` handlers.
- Events live in `src/events` and export `name`, `once` (optional), and `execute`.

Database

- The project uses `knex` as a lightweight DB adapter. By default it will create a local SQLite database at `data/dev.sqlite` for development.
- To use a remote DB (Postgres), set `DATABASE_URL` in your `.env` (e.g. `postgres://user:pass@host:5432/dbname`). The code will automatically use Postgres when `DATABASE_URL` is present.
- A basic `users` table is auto-created on startup in non-production via a simple migration.

Telemetry / Remote Error Reporting

- Optional Sentry integration is available. Set `SENTRY_DSN` in your `.env` to enable Sentry crash reporting and error capture. The bot will automatically send uncaught exceptions and unhandled rejections.

Environment

- Increase verbosity in development by setting `LOG_LEVEL=debug` in your environment.

Files of interest

- `src/index.js` — bot entrypoint and loader
- `deploy-commands.js` — small script to register commands
- `config/config.json` — simple config (prefix, owner)
 - `config/bot.public.json` — non-secret metadata for the public bot (token read from env `TOKEN`)
 - `config/bot.dev.json` — non-secret metadata for the development bot (token read from env `TOKEN_DEV` by default)
