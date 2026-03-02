const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').get('db');

async function createKnex() {
  const dbUrl = process.env.DATABASE_URL;
  // Attempt to require knex synchronously; if the package is ESM, fall back to dynamic import
  let knexLib;
  try {
    knexLib = require('knex');
  } catch (reqErr) {
    try {
      // dynamic import for ESM package
      const mod = await import('knex');
      knexLib = mod && (mod.default || mod);
    } catch (impErr) {
      throw reqErr; // rethrow original error for clarity
    }
  }

  if (dbUrl) {
    // If DATABASE_URL is provided, attempt to detect the DB client (pg or mysql2).
    let client = 'pg';
    let connection = dbUrl;
    try {
      let parsed;
      try {
        parsed = new URL(dbUrl);
      } catch (parseErr) {
        // If scheme missing (e.g. host:port/db), try guessing based on common ports
        if (dbUrl.includes(':3306')) parsed = new URL(`mysql://${dbUrl}`);
        else if (dbUrl.includes(':5432')) parsed = new URL(`postgres://${dbUrl}`);
        else {
          // default to postgres parsing attempt
          parsed = new URL(`postgres://${dbUrl}`);
        }
        connection = parsed.toString();
      }

      const proto = (parsed.protocol || '').replace(':', '').toLowerCase();
      if (proto === 'mysql' || proto === 'mariadb') client = 'mysql2';
      else if (proto === 'postgres' || proto === 'postgresql') client = 'pg';
      else if (proto === 'sqlite' || proto === 'sqlite3') client = 'sqlite3';
      // Heuristic: if the original URL contains common MySQL port, prefer mysql2
      if (dbUrl.includes(':3306') && client !== 'mysql2') {
        logger.warn('DATABASE_URL appears to target MySQL (port 3306); switching client to mysql2', { url: dbUrl.split('?')[0], previousClient: client });
        client = 'mysql2';
      }
      logger.info('Using DATABASE_URL', { url: connection.split('?')[0], client });
    } catch (e) {
      // Fallback: assume Postgres but log that detection failed
      logger.warn('Could not fully parse DATABASE_URL; defaulting to pg client', { url: dbUrl });
      client = 'pg';
      connection = dbUrl;
    }

    try {
      // Optimized pool settings for high concurrency
      const pool = {
        min: 2,  // Maintain minimum connections to reduce latency
        max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : 20,  // Handle more concurrent requests
        acquireTimeoutMillis: 60000,  // 60s timeout for acquiring connection
        idleTimeoutMillis: 30000,  // Close idle connections after 30s
        propagateCreateError: false  // Don't crash on connection pool errors
      };
      return knexLib({ client, connection, pool });
    } catch (err) {
      logger.error('Failed creating knex for DATABASE_URL — missing or incompatible DB driver', { client, error: err && (err.stack || err) });
      throw err;
    }
  }

  // Default: local SQLite file for quick development
  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'dev.sqlite');
  logger.info('Using local SQLite DB', { filename });
  return knexLib({ client: 'sqlite3', connection: { filename }, useNullAsDefault: true });
}

let knex = null;

async function createSqliteKnex() {
  // similar dynamic require/import for knex
  let knexLib;
  try {
    knexLib = require('knex');
  } catch (reqErr) {
    const mod = await import('knex');
    knexLib = mod && (mod.default || mod);
  }
  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'dev.sqlite');
  logger.info('Falling back to local SQLite DB', { filename });
  return knexLib({ client: 'sqlite3', connection: { filename }, useNullAsDefault: true });
}

async function migrate() {
  // ensure knex is initialized lazily (avoid top-level require of knex which may be ESM)
  if (!knex) {
    knex = await createKnex();
  }
  // If a DATABASE_URL is set, test the connection and fall back to SQLite on ECONNREFUSED.
  if (process.env.DATABASE_URL) {
    try {
      await knex.raw('select 1');
    } catch (e) {
      const str = (e && (e.stack || e.message || '')).toString();
      if (str.includes('ECONNREFUSED') || str.includes('connect ECONNREFUSED')) {
        logger.warn('DB connection refused for DATABASE_URL; falling back to local SQLite', { error: str });
        try {
          await knex.destroy();
        } catch (_) {}
        knex = await createSqliteKnex();
      } else {
        // non-connection error - rethrow so migrate() fails loudly
        throw e;
      }
    }
  }
  try {
    const exists = await knex.schema.hasTable('users');
    if (!exists) {
      await knex.schema.createTable('users', (table) => {
        table.increments('id').primary();
        table.string('discord_id').unique().notNullable();
        table.json('data');
        table.timestamps(true, true);
      });
      logger.info('Created `users` table');
    } else {
      logger.info('`users` table already exists');
    }
    // guild settings table
    const gExists = await knex.schema.hasTable('guild_settings');
    if (!gExists) {
      await knex.schema.createTable('guild_settings', (table) => {
        table.increments('id').primary();
        table.string('guild_id').unique().notNullable();
        table.string('channel_id');
        // persisted next scheduled spawn timestamp (ms since epoch)
        table.bigInteger('next_spawn_at');
        // spawn min/max in seconds
        table.integer('spawn_min_seconds').defaultTo(60);
        table.integer('spawn_max_seconds').defaultTo(3600);
        table.integer('egg_limit').defaultTo(5);
        table.json('data');
        table.timestamps(true, true);
      });
      logger.info('Created `guild_settings` table');
    } else {
      logger.info('`guild_settings` table already exists');
      // Ensure new columns exist (migrate from spawn_rate_minutes if needed)
      const hasMin = await knex.schema.hasColumn('guild_settings', 'spawn_min_seconds');
      const hasMax = await knex.schema.hasColumn('guild_settings', 'spawn_max_seconds');
      const hasOld = await knex.schema.hasColumn('guild_settings', 'spawn_rate_minutes');
      const hasNextSpawnAt = await knex.schema.hasColumn('guild_settings', 'next_spawn_at');
      if (!hasMin || !hasMax || !hasNextSpawnAt) {
        // Add columns one-by-one and tolerate "duplicate column" errors
        const isDuplicateColumnError = (e) => {
          const msg = (e && (e.stack || e.message || '')).toString();
          return msg.includes('duplicate column name') || msg.includes('already exists');
        };

        if (!hasMin) {
          try {
            // Add column without SQL-level default so existing rows are not overwritten
            await knex.schema.alterTable('guild_settings', (table) => {
              table.integer('spawn_min_seconds');
            });
            logger.info('Added spawn_min_seconds to guild_settings');
          } catch (e) {
            if (isDuplicateColumnError(e)) logger.warn('spawn_min_seconds column already exists, ignoring');
            else throw e;
          }
        }

        if (!hasMax) {
          try {
            // Add column without SQL-level default so existing rows are not overwritten
            await knex.schema.alterTable('guild_settings', (table) => {
              table.integer('spawn_max_seconds');
            });
            logger.info('Added spawn_max_seconds to guild_settings');
          } catch (e) {
            if (isDuplicateColumnError(e)) logger.warn('spawn_max_seconds column already exists, ignoring');
            else throw e;
          }
        }

        if (!hasNextSpawnAt) {
          try {
            await knex.schema.alterTable('guild_settings', (table) => {
              table.bigInteger('next_spawn_at');
            });
            logger.info('Added next_spawn_at to guild_settings');
          } catch (e) {
            if (isDuplicateColumnError(e)) logger.warn('next_spawn_at column already exists, ignoring');
            else throw e;
          }
        }
      }
      if (hasOld) {
        try {
          // Migrate existing minute-based values into seconds where possible
          const rows = await knex('guild_settings').select('id', 'spawn_rate_minutes');
          for (const r of rows) {
            const mins = r.spawn_rate_minutes || null;
            if (mins !== null) {
              const seconds = Math.max(30, Math.min(21600, Number(mins) * 60));
              // set both min and max to previous value (converted)
              await knex('guild_settings').where({ id: r.id }).update({ spawn_min_seconds: seconds, spawn_max_seconds: seconds });
            }
          }
          logger.info('Migrated spawn_rate_minutes to spawn_min_seconds/spawn_max_seconds');
        } catch (e) {
          logger.error('Failed migrating spawn_rate_minutes', { error: e.stack || e });
        }
      }
    }
  } catch (err) {
    logger.error('Migration failed', { error: err.stack || err });
    throw err;
  }

  // active spawns table: persist active egg events so they survive restarts
  try {
    const hasActive = await knex.schema.hasTable('active_spawns');
    if (!hasActive) {
      await knex.schema.createTable('active_spawns', (table) => {
        table.increments('id').primary();
        table.string('guild_id').notNullable();
        table.string('message_id').notNullable();
        table.string('channel_id').notNullable();
        table.bigInteger('spawned_at').notNullable();
        table.integer('num_eggs').notNullable().defaultTo(1);
        table.string('egg_type').notNullable();
        table.timestamps(true, true);
      });
      logger.info('Created `active_spawns` table');
    } else {
      logger.info('`active_spawns` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring active_spawns table', { error: err.stack || err });
    throw err;
  }

  // sessions table for dashboard/session storage
  try {
    const hasSessions = await knex.schema.hasTable('sessions');
    if (!hasSessions) {
      await knex.schema.createTable('sessions', (table) => {
        table.string('sid').primary();
        table.text('sess');
        table.bigInteger('expires');
        table.timestamps(true, true);
      });
      logger.info('Created `sessions` table');
    } else {
      logger.info('`sessions` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring sessions table', { error: err.stack || err });
    throw err;
  }

  // bot_guilds table: cache of guild ids the bot is present in (populated by the bot or by the dashboard checks)
  try {
    const hasBotGuilds = await knex.schema.hasTable('bot_guilds');
    if (!hasBotGuilds) {
      await knex.schema.createTable('bot_guilds', (table) => {
        table.string('guild_id').primary();
        table.bigInteger('cached_at').notNullable();
        table.timestamps(true, true);
      });
      logger.info('Created `bot_guilds` table');
    } else {
      logger.info('`bot_guilds` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring bot_guilds table', { error: err.stack || err });
    throw err;
  }

  // hatches table: persist egg hatching jobs so they survive restarts
  try {
    const hasHatches = await knex.schema.hasTable('hatches');
    if (!hasHatches) {
      await knex.schema.createTable('hatches', (table) => {
        table.increments('id').primary();
        table.string('discord_id').notNullable();
        table.string('guild_id').notNullable();
        table.string('egg_type').notNullable();
        table.bigInteger('started_at').notNullable();
        table.bigInteger('finishes_at').notNullable();
        table.boolean('collected').notNullable().defaultTo(false);
        table.boolean('skipped').notNullable().defaultTo(false);
        table.timestamps(true, true);
      });
      logger.info('Created `hatches` table');
    } else {
      logger.info('`hatches` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring hatches table', { error: err.stack || err });
    throw err;
  }
  
  // hives table: per-user hive data
  try {
    const hasHives = await knex.schema.hasTable('hives');
    if (!hasHives) {
      await knex.schema.createTable('hives', (table) => {
        table.increments('id').primary();
        table.string('user_id').notNullable().unique();
        table.string('guild_id').nullable(); // Per-guild hive support
        table.string('name').defaultTo('My Hive');
        table.string('hive_type').defaultTo('default');
        table.string('queen_xeno_id');
        table.integer('capacity').defaultTo(5);
        table.float('jelly_production_per_hour').defaultTo(0);
        table.json('data');
        table.timestamps(true, true);
      });
      logger.info('Created `hives` table');
    } else {
      logger.info('`hives` table already exists');
      // Add guild_id column if it doesn't exist
      const hasGuildColumn = await knex.schema.hasColumn('hives', 'guild_id');
      if (!hasGuildColumn) {
        await knex.schema.alterTable('hives', (table) => {
          table.string('guild_id').nullable();
        });
        logger.info('Added `guild_id` column to `hives` table');
      }
    }
  } catch (err) {
    logger.error('Failed ensuring hives table', { error: err.stack || err });
    throw err;
  }

  // user_resources: store per-user resource balances (royal jelly, spores, stabilizers)
  try {
    const hasResources = await knex.schema.hasTable('user_resources');
    if (!hasResources) {
      await knex.schema.createTable('user_resources', (table) => {
        table.increments('id').primary();
        table.string('user_id').unique().notNullable();
        table.bigInteger('royal_jelly').defaultTo(0);
        table.bigInteger('pathogen_spores').defaultTo(0);
        table.bigInteger('stabilizers').defaultTo(0);
        table.timestamps(true, true);
      });
      logger.info('Created `user_resources` table');
    } else {
      logger.info('`user_resources` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring user_resources table', { error: err.stack || err });
    throw err;
  }

  // xenomorphs: individual creatures owned by users/hives
  try {
    const hasXenos = await knex.schema.hasTable('xenomorphs');
    if (!hasXenos) {
      await knex.schema.createTable('xenomorphs', (table) => {
        table.increments('id').primary();
        table.string('owner_id').notNullable();
        table.integer('hive_id').nullable();
        table.string('pathway').defaultTo('standard');
        table.string('role').defaultTo('egg');
        table.string('stage').defaultTo('egg');
        table.integer('level').defaultTo(1);
        table.json('stats');
        table.json('data');
        table.timestamps(true, true);
      });
      logger.info('Created `xenomorphs` table');
    } else {
      logger.info('`xenomorphs` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring xenomorphs table', { error: err.stack || err });
    throw err;
  }

  // evolution_paths: optional table to store canonical evolution definitions
  try {
    const hasPaths = await knex.schema.hasTable('evolution_paths');
    if (!hasPaths) {
      await knex.schema.createTable('evolution_paths', (table) => {
        table.increments('id').primary();
        table.string('key').unique().notNullable();
        table.string('name').notNullable();
        table.json('definition');
        table.timestamps(true, true);
      });
      logger.info('Created `evolution_paths` table');
    } else {
      logger.info('`evolution_paths` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring evolution_paths table', { error: err.stack || err });
    throw err;
  }

  // hosts: persist hunted hosts per user
  try {
    const hasHosts = await knex.schema.hasTable('hosts');
    if (!hasHosts) {
      await knex.schema.createTable('hosts', (table) => {
        table.increments('id').primary();
        table.string('owner_id').notNullable().index();
        table.string('host_type').notNullable();
        table.bigInteger('found_at').notNullable();
        table.json('data');
        table.timestamps(true, true);
      });
      logger.info('Created `hosts` table');
    } else {
      logger.info('`hosts` table already exists');
    }
    // If there's an existing data/hosts.json file and the hosts table is empty,
    // import the entries to the DB to preserve user data from the file-backed model.
    try {
      const hostsFile = path.join(__dirname, '..', '..', 'data', 'hosts.json');
      if (fs.existsSync(hostsFile)) {
        try {
          const raw = fs.readFileSync(hostsFile, 'utf8');
          const parsed = raw && raw.trim().length ? JSON.parse(raw) : [];
          if (Array.isArray(parsed) && parsed.length > 0) {
            const [{ cnt: currentCount } = { cnt: 0 }] = await knex('hosts').count('* as cnt');
            if (Number(currentCount || 0) === 0) {
              const toInsert = parsed.map(p => {
                const owner = p.owner_discord_id || p.owner_id || p.owner || '';
                const hostType = p.host_type || p.hostType || p.type || p.host || 'human';
                const created = p.created_at ? Date.parse(p.created_at) : (p.found_at ? Number(p.found_at) : Date.now());
                return { owner_id: String(owner), host_type: String(hostType), found_at: Number(created) || Date.now(), data: p.data ? JSON.stringify(p.data) : null };
              });
              if (toInsert.length) {
                try { await knex('hosts').insert(toInsert); logger.info('Imported hosts from data/hosts.json into DB', { count: toInsert.length }); } catch (ie) { logger.warn('Failed importing hosts.json into DB', { error: ie && (ie.stack || ie) }); }
              }
            }
          }
        } catch (e) {
          logger.warn('Failed parsing data/hosts.json during import', { error: e && e.message });
        }
      }
    } catch (ie) { logger.warn('Hosts import check failed', { error: ie && ie.message }); }
  } catch (err) {
    logger.error('Failed ensuring hosts table', { error: err.stack || err });
    throw err;
  }

  // evolution_queue: scheduled evolution jobs
  try {
    const hasQueue = await knex.schema.hasTable('evolution_queue');
    if (!hasQueue) {
      await knex.schema.createTable('evolution_queue', (table) => {
        table.increments('id').primary();
        table.integer('xeno_id').notNullable();
        table.string('user_id').notNullable();
        table.integer('hive_id').nullable();
        table.string('target_role').notNullable();
        table.bigInteger('started_at').nullable();
        table.bigInteger('finishes_at').notNullable();
        table.bigInteger('cost_jelly').defaultTo(0);
        table.boolean('stabilizer_used').defaultTo(false);
        table.string('status').defaultTo('queued');
        table.string('result').nullable();
        table.timestamps(true, true);
      });
      logger.info('Created `evolution_queue` table');
    } else {
      logger.info('`evolution_queue` table already exists');
    }
  } catch (err) {
    logger.error('Failed ensuring evolution_queue table', { error: err.stack || err });
    throw err;
  }
}

module.exports = {
  get knex() { return knex; },
  migrate
};
