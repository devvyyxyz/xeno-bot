const dbModule = require('../src/db');
const hiveWorker = require('../src/hiveWorker');
const userModel = require('../src/models/user');
const hiveModel = require('../src/models/hive');

beforeAll(async () => {
  await dbModule.migrate();
});

afterEach(async () => {
  // Clean up test data
  const knex = dbModule.knex;
  await knex('hives').delete();
  await knex('users').delete();
});

afterAll(async () => {
  const k = dbModule.knex;
  try { await k.destroy(); } catch (_) {}
});

describe('hiveWorker', () => {
  describe('processHives', () => {
    test('awards jelly production based on time elapsed', async () => {
      const knex = dbModule.knex;
      const userId = 'test-user-1';

      // Create user with baseline data
      await knex('users').insert({
        discord_id: userId,
        data: JSON.stringify({
          guilds: {
            'test-guild': {
              currency: { royal_jelly: 100 }
            }
          }
        })
      });

      // Create hive with 1 jelly per hour
      const now = Date.now();
      const twoHoursAgo = now - (2 * 3600000);
      const hiveData = JSON.stringify({
        last_collected_at: twoHoursAgo
      });
      const hiveId = await knex('hives').insert({
        user_id: userId,
        guild_id: 'test-guild',
        name: 'Test Hive',
        jelly_production_per_hour: 1,
        data: hiveData
      });
      const hiveIdVal = Array.isArray(hiveId) ? hiveId[0] : hiveId;

      // Process hives
      const processed = await hiveWorker.processHives();

      // Verify 2 jelly were awarded (2 hours × 1 per hour)
      expect(processed).toBe(1);

      // Check that currency was updated
      const updatedUser = await userModel.getUserByDiscordId(userId);
      const guildCurrency = updatedUser?.data?.guilds?.['test-guild']?.currency?.royal_jelly || 0;
      expect(guildCurrency).toBe(102); // 100 starting + 2 awarded

      // Check that hive timestamp was updated
      const updatedHive = await hiveModel.getHiveById(hiveIdVal);
      const hiveDataParsed = JSON.parse(updatedHive.data || '{}');
      expect(hiveDataParsed.last_collected_at).toBeGreaterThan(twoHoursAgo);
    });

    test('skips hives with zero or negative production rate', async () => {
      const knex = dbModule.knex;
      const userId = 'test-user-2';

      await knex('users').insert({
        discord_id: userId,
        data: JSON.stringify({
          guilds: {
            'test-guild': {
              currency: { royal_jelly: 100 }
            }
          }
        })
      });

      // Create hive with 0 production
      await knex('hives').insert({
        user_id: userId,
        guild_id: 'test-guild',
        name: 'Inactive Hive',
        jelly_production_per_hour: 0,
        data: '{}'
      });

      const processed = await hiveWorker.processHives();
      expect(processed).toBe(0);

      // Currency should remain unchanged
      const user = await userModel.getUserByDiscordId(userId);
      const guildCurrency = user?.data?.guilds?.['test-guild']?.currency?.royal_jelly || 0;
      expect(guildCurrency).toBe(100);
    });

    test('handles multiple hives for same user', async () => {
      const knex = dbModule.knex;
      const userId = 'test-user-3';

      await knex('users').insert({
        discord_id: userId,
        data: JSON.stringify({
          guilds: {
            'test-guild': {
              currency: { royal_jelly: 0 }
            }
          }
        })
      });

      const now = Date.now();
      const oneHourAgo = now - 3600000;

      // Create two hives with different production rates
      await knex('hives').insert({
        user_id: userId,
        guild_id: 'test-guild',
        name: 'Hive 1',
        jelly_production_per_hour: 5,
        data: JSON.stringify({ last_collected_at: oneHourAgo })
      });

      await knex('hives').insert({
        user_id: userId,
        guild_id: 'test-guild',
        name: 'Hive 2',
        jelly_production_per_hour: 3,
        data: JSON.stringify({ last_collected_at: oneHourAgo })
      });

      const processed = await hiveWorker.processHives();
      expect(processed).toBe(2);

      // Check total awards: 5 + 3 = 8
      const user = await userModel.getUserByDiscordId(userId);
      const guildCurrency = user?.data?.guilds?.['test-guild']?.currency?.royal_jelly || 0;
      expect(guildCurrency).toBe(8);
    });

    test('maintains atomic transaction: award and timestamp update together', async () => {
      const knex = dbModule.knex;
      const userId = 'test-user-4';

      await knex('users').insert({
        discord_id: userId,
        data: JSON.stringify({
          guilds: {
            'test-guild': {
              currency: { royal_jelly: 50 }
            }
          }
        })
      });

      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const hiveData = JSON.stringify({ last_collected_at: oneHourAgo });

      const hiveId = await knex('hives').insert({
        user_id: userId,
        guild_id: 'test-guild',
        name: 'atomic-test-hive',
        jelly_production_per_hour: 10,
        data: hiveData
      });
      const hiveIdVal = Array.isArray(hiveId) ? hiveId[0] : hiveId;

      // Process once
      const processed1 = await hiveWorker.processHives();
      expect(processed1).toBe(1);

      // Get the updated timestamp
      const hive1 = await hiveModel.getHiveById(hiveIdVal);
      const timestamp1 = JSON.parse(hive1.data).last_collected_at;

      // Process again immediately (should award 0 because timestamp was updated)
      const processed2 = await hiveWorker.processHives();
      expect(processed2).toBe(0);

      // Verify timestamp didn't change (no award, no timestamp update)
      const hive2 = await hiveModel.getHiveById(hiveIdVal);
      const timestamp2 = JSON.parse(hive2.data).last_collected_at;
      expect(timestamp2).toBe(timestamp1);

      // Verify currency didn't increase again
      const user = await userModel.getUserByDiscordId(userId);
      const guildCurrency = user?.data?.guilds?.['test-guild']?.currency?.royal_jelly || 0;
      expect(guildCurrency).toBe(60); // 50 + 10, only awarded once
    });

    test('handles empty/null hive data gracefully', async () => {
      const knex = dbModule.knex;
      const userId = 'test-user-5';

      await knex('users').insert({
        discord_id: userId,
        data: JSON.stringify({
          guilds: {
            'test-guild': {
              currency: { royal_jelly: 0 }
            }
          }
        })
      });

      // Create hive with null data field
      await knex('hives').insert({
        user_id: userId,
        guild_id: 'test-guild',
        name: 'null-data-hive',
        jelly_production_per_hour: 5,
        data: null
      });

      // Should not crash and should award based on created_at
      const processed = await hiveWorker.processHives();
      expect(processed).toBeGreaterThanOrEqual(0);
    });

    test('respects guild_id scoping', async () => {
      const knex = dbModule.knex;
      const userId = 'test-user-6';

      // Create user with currency in multiple guilds
      await knex('users').insert({
        discord_id: userId,
        data: JSON.stringify({
          guilds: {
            'guild-1': { currency: { royal_jelly: 100 } },
            'guild-2': { currency: { royal_jelly: 200 } }
          }
        })
      });

      const now = Date.now();
      const oneHourAgo = now - 3600000;

      // Create hives in both guilds
      await knex('hives').insert({
        user_id: userId,
        guild_id: 'guild-1',
        name: 'Hive G1',
        jelly_production_per_hour: 10,
        data: JSON.stringify({ last_collected_at: oneHourAgo })
      });

      await knex('hives').insert({
        user_id: userId,
        guild_id: 'guild-2',
        name: 'Hive G2',
        jelly_production_per_hour: 20,
        data: JSON.stringify({ last_collected_at: oneHourAgo })
      });

      const processed = await hiveWorker.processHives();
      expect(processed).toBe(2);

      // Verify each guild currency was updated separately
      const user = await userModel.getUserByDiscordId(userId);
      const guild1Currency = user?.data?.guilds?.['guild-1']?.currency?.royal_jelly || 0;
      const guild2Currency = user?.data?.guilds?.['guild-2']?.currency?.royal_jelly || 0;
      expect(guild1Currency).toBe(110);
      expect(guild2Currency).toBe(220);
    });
  });
});
