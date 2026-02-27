const fs = require('fs');
const path = require('path');
const knexLib = require('knex');
const logger = require('../utils/logger').get('db');

function createKnex() {
  const dbUrl = process.env.DATABASE_URL;
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
      return knexLib({ client, connection, pool: { min: 0, max: 7 } });
    } catch (err) {
      // Likely missing DB driver (e.g., mysql2). Provide actionable log then fallback later.
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

let knex = createKnex();

function createSqliteKnex() {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'dev.sqlite');
  logger.info('Falling back to local SQLite DB', { filename });
  return knexLib({ client: 'sqlite3', connection: { filename }, useNullAsDefault: true });
}

async function migrate() {
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
        knex = createSqliteKnex();
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
}

module.exports = {
  get knex() { return knex; },
  migrate
};
