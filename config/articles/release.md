# Version History

This document is a generated changelog-style history of the project built from the repository commit history (chronological). It summarizes major changes and milestones from the initial commit through the recent feature work.

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

----

Notes:

- This file was generated from the repository commit history. Commit SHAs referenced above appear in the git history and can be examined for full diffs; see `git log` for the latest details.
- If you would like a strictly semantic version mapping (i.e., exact commits grouped under explicit version tags), I can create annotated tags and produce a canonical changelog per tag.
