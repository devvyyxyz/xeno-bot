# Version History

View the full changelog of xeno-bot's development progress, including all features, improvements, and fixes across versions. Each version entry includes a summary of changes and links to relevant commits for more details.

----

## v0.1.0 — Initial commit

Date: 2026-02-27

- Initial project scaffold and first commit (6f75204).

## v0.2.0 — Core utilities, DB and command scaffolding

Date: 2026-02-27

- Implemented `safeReply` utility for consistent interaction responses (4fc2da8).
- Refactored database access into a unified `db` module and improved DATABASE_URL handling for MySQL/Postgres (4717292, adef985).
- Removed local SQLite binary from repository and updated .gitignore (dcac588).
- Added `checkcommands` utility and enhanced command loading/logging (93c061e, efde13f).
- Fixed various spawn/knex/interaction reference bugs discovered during initial integration (9d040f7, 9ef0ad8, e40b4d4).

## v0.3.0 — Commands, setup and autocomplete

Date: 2026-02-27 — 2026-02-28

- Added `setup` command enhancements including a `details` subcommand and safer `executeInteraction` use (0dad7a9, 867b29c).
- Added `autocomplete` improvements and logging for choices (227bd1b).
- Added `eggs` features (list/collect/hatch support) and related command adjustments (04d5995, 857dd71).

## v0.4.0 — Preview join, buttons, and news command (initial)

Date: 2026-02-28

- Added a developer-only `previewjoin` command to preview the guild join embed and improved join/guildCreate handling (6ab96d9, 3f4d149).
- Implemented runtime-safe button creation (builders vs raw payload) to maintain compatibility across environments (785affe).
- Introduced initial `news` command for reading and paginating latest articles (2a29a52).

## v0.5.0 — Deploy & profile improvements

Date: 2026-02-28

- Improved command deploy scripts and profile selection to be safer for dev vs public registration, and added default guildId support for deploy flows (82192b9, 84f985d, 9f04d4e).

## v0.6.0 — Logging hardening & fallback logger

Date: 2026-02-28

- Added a resilient file-backed `fallbackLogger` for last-resort synchronous logging (cd819a3).
- Adjusted console logging output so `npm start` formats match development console output (99ff5be, 0b1a377, a0d981a, 4651848, 5ba41b4).
- Added ability to force ANSI colors in logs via environment flags for consistent formatting in non-TTY environments (e4b77f2).

## v0.7.0 — Message component handling / collector helper

Date: 2026-02-28

- Introduced `createInteractionCollector` helper to reliably attach MessageComponentCollectors to interaction replies; this centralizes the defer/edit/fetch pattern and reduces repeated boilerplate (bee298f, 6382363, f4c51c7).
- Refactored commands to use the helper (inventory, shop, news, help, leaderboard, encyclopedia) to improve stability and avoid TypeErrors when attaching collectors (464c7e3, 9dd81ce, 3f2c915).

## v0.8.0 — Links configuration and news home improvements

Date: 2026-02-28

- Reworked `config/links.json` into a categorized structure (e.g., `general`, `community`) and updated commands/events to support both the new shape and the legacy flat shape for backward compatibility (6c11509).
- Improved `news` command home view to include:
  - An Introduction field
  - Quick Links (categorized or flat) rendered as embedded link lists
  - Latest article preview with title and truncated body
  - Bot avatar thumbnail on the Home embed
  - Category selector buttons to open per-category article lists stored under `config/articles/`
  (commits: 3ce5a60, b56c851, 3f2c915, 6afb398)

## v1.0.0 — Minor improvements and cleanup

Date: 2026-02-28

- Continued refinements to the `news` UX, quick links handling, and collector integration (3c9ce90, 6afb398).
- Created per-category article files in `config/articles/` and populated example content for `release`, `events`, `newsletter`, and `other` (3f2c915, 3ce5a60).

## v1.1.0 — Improvements, telemetry, and stability

Date: 2026-02-28

- Bump package to `1.1.0` and publish-ready metadata.
- Hardened logging and sanitization: added redaction for sensitive env values in health and log-tail outputs, file-backed `fallbackLogger`, and forced-ANSI support for consistent logs in non-TTY environments.
- `/health` redesign: switched to subcommands (`show` and `lastlogs`), added developer `detail` levels, owner-only `lastlogs` with rate-limiting and audit entries, and masked secrets as `*****` in outputs.
- Collector helper and command hardening: centralized `createInteractionCollector`, fixed many collector integrations across commands to avoid component attach errors.
- `/info` styling and runtime values: `info` now reports real runtime values (Node, discord.js, gateway ping, shard info, cached counts) and includes thumbnail/footer/timestamp for clarity.
- `/stats` overhaul: reorganized layout, combined server/global views, added SQL-backed leaderboard ranking via `egg_catches`, and per-egg historical rates computed from recorded events.
- Egg recording and analytics: added `egg_catches` table and `recordEggCatch()` to persist timestamped catch events and keep aggregate `egg_stats` in sync.
- Spawn loop fix: ensured the spawn manager always schedules the next spawn after events complete to avoid the loop stopping unexpectedly.
- Various small fixes and compatibility updates across commands, configuration, and deploy flows.

----

## v1.2.0 — News, Shop, Inventory, and Currency Improvements

Released: 2026-02-28

This release introduces multiple user-facing features, bug fixes, and developer tools. Highlights:

### Key Features

- News/Home improvements
  - The news home now automatically previews the most recent article (uses file modification timestamps to detect newest content).
  - Added `src/utils/articles.js` to reliably detect latest article title/content with short caching.
  - When a user opens `/news` the bot records the latest article timestamp as read for that user so reminders stop.
  - Added a per-user unread-article reminder that shows on commands when a newer article is available; reminders are cleared when the user reads the article.

- Inventory UI & Currencies
  - Added a `Currencies` tab to `Inventory` showing `credits` (global) and `royal_jelly` (guild).
  - Fixed an issue where the inventory view showed an "Avatar / View Avatar" placeholder when the user had no items — avatar only appears when items exist.
  - `credits` is now a global currency stored under `data.currency.credits` (not per-guild). Default value is `0` via `config/userDefaults.json`.

- Shop & Items
  - Shop UI now displays configured emojis and uses a stable button implementation compatible with the repo's discord.js/builders versions.
  - Removed purchasable eggs/cosmetics from the shop and added consumable items and boosts.
  - Fixed buy flow robustness and purchase confirmation messaging; purchases correctly deduct currency and add items.

- Developer & Ops
  - Added several developer-only commands and hid them from normal help listings.
  - Hardened `deveval` with blacklists and logging.
  - Added owner bypasses for setup and text-mode `forcespawn` commands.

- Data & Migrations
  - Made `credits` a global currency: added `scripts/migrate-credits-global.js` to migrate guild-level credits to global credits (dry-run and apply modes).
  - Added `scripts/migrate-mark-articles-read.js` to initialize `data.meta.lastReadArticleAt` for existing users so they won't immediately see unread reminders.

### Bug Fixes

- Fixed a TypeError related to `ButtonBuilder` incompatibilities by using the builders-provided `SecondaryButtonBuilder`/`SuccessButtonBuilder` fallback when appropriate.
- Fixed interaction handling so the news-reminder check is performed asynchronously and does not block command handling (avoids "The application did not respond").
- Adjusted inventory and shop collectors to be robust against rejected component payloads.

### Notes for Server Operators

- Run `node scripts/migrate-credits-global.js --apply` if you have legacy `credits` stored per-guild and want them consolidated into global balances.
- A one-time migration to mark all users as read was included and run during development. If you prefer a different initial state, run `node scripts/migrate-mark-articles-read.js` (dry-run without `--apply`).

### Internal

- Version bumped to `1.2.0`.
- Tests run locally and passed after changes.

## v1.3.0 — Help UX, embed colour unification, spawn deletion toggle

Date: 2026-02-28

- Added a guild-level toggle to delete the original spawn message after it is caught (`/setup message-delete enabled:<true|false>`). The setting is persisted under `guild_settings.data.delete_spawn_message` and defaults to `false` in `config/guildDefaults.json`.
- Implemented spawn-message deletion in the spawn manager with robust channel/message fetch and a `Manage Messages` permission check. Failures are logged but do not surface user-facing errors.
- Unified embed colour across commands: added a top-level `colour` in `config/commands.json`, normalized color strings to numeric values in the commands loader, and fixed EmbedBuilder ValidationErrors by using numeric fallbacks.
- Improved Help UX: added "About" and "Setup (Server Admins)" sections, removed the `usage` display (and removed `usage` fields from the commands config), fixed category listing and selection bugs, and restored clickable setup mentions where application command IDs are available.
- Added a developer-only `devgive` command and registered it for owner use.
- Migrated many commands to a per-command directory layout while keeping legacy files to preserve history and ease rollout.
- Logging and diagnostics: event/load logs now include event names, spawn/hatch logs include `guildName` when available, and fallback logging was hardened for edge cases.
- Fixed several runtime and syntax issues introduced during refactors (help selection population, truncated help file syntax, and embed color validation).

Notes:

- The spawn deletion feature defaults to off; enable via `/setup message-delete enabled:true` to start deleting spawn messages after a catch.
- Additional followups: add an admin-facing notice when the bot lacks `Manage Messages` permission in the spawn channel, and consider de-duplicating legacy flat command files in a future cleanup release.

## v1.4.0 — DevMenu, logging improvements, and leaderboard fixes

Date: 2026-03-02

### Key Features

- **DevMenu command**: Converted `xen!devcommands` to a new `xen!devmenu` interactive command with owner-only action buttons for developer maintenance:
  - Migrate Facehuggers, Restart Hatch Manager, Restart Spawn Manager, Clear Expired Spawns, Sync Guild Cache, Force Migration
  - Uses direct message component collectors for message command compatibility
  - 5-minute idle timeout with expired state UI

- **Enhanced logging with guild context**: Added guild names to spawn and hatch manager logs:
  - New `getGuildName()` helper with cache lookup and fallbacks in both managers
  - Updated 15+ log entries to include guild context: `[info] [spawn] doSpawn entered (My Server)`
  - Improves visibility for multi-guild bot operations

- **Eggs command options registration**: Fixed missing option definitions in `config/commands.json`:
  - Added full `options` arrays for all 6 eggs subcommands (hatch, sell, info, destroy, collect, list)
  - Properly registered `egg` (string, required, autocomplete) and `amount` (integer, optional) parameters
  - Public bot deployment now correctly registers all options with Discord

- **Leaderboard server filtering fix**: Fixed `/leaderboard server` showing global data:
  - Server leaderboard now filters to only users with eggs in current guild
  - Uses guild-specific catch time stats for fastest/slowest rankings
  - Skips users with no guild data or zero eggs collected
  - Global leaderboard continues to aggregate all guilds as designed

### Bug Fixes

- Fixed DevMenu collector type mismatch (now uses message collectors, not interaction collectors)
- Fixed guild name resolution in logs to properly display server names
- Fixed leaderboard server subcommand to correctly filter and rank users by guild

### Internal

- Version bumped to `1.4.0`.
- All improvements deployed to production.
