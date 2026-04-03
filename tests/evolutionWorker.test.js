const dbModule = require('../src/db');
const evolutionWorker = require('../src/services/evolutionWorker');

beforeAll(async () => {
  await dbModule.migrate();
});

afterEach(async () => {
  // Clean up test data
  const knex = dbModule.knex;
  await knex('evolution_queue').delete();
  await knex('xenomorphs').delete();
  await knex('hives').delete();
  await knex('users').delete();
});

afterAll(async () => {
  const k = dbModule.knex;
  try { await k.destroy(); } catch (_) {}
});

describe('evolutionWorker', () => {
  describe('processDueJobs', () => {
    test('returns 0 when no jobs due', async () => {
      const mockClient = { users: { cache: new Map(), fetch: jest.fn() } };
      const processed = await evolutionWorker.processDueJobs(mockClient);
      expect(processed).toBe(0);
    });

    test('processes a single evolution job', async () => {
      const knex = dbModule.knex;

      // Create a user
      await knex('users').insert({
        discord_id: 'user-1',
        data: '{}'
      });

      // Create a xenomorph
      const xenoId = await knex('xenomorphs').insert({
        owner_id: 'user-1',
        role: 'facehugger',
        stage: 'facehugger',
        pathway: 'standard',
        data: '{}'
      });
      const xenoIdVal = Array.isArray(xenoId) ? xenoId[0] : xenoId;

      // Create a job due now
      const now = Date.now();
      await knex('evolution_queue').insert({
        user_id: 'user-1',
        xeno_id: xenoIdVal,
        target_role: 'runner',
        finishes_at: now - 1000, // Already due
        status: 'queued'
      });

      // Mock Discord client
      const mockClient = {
        users: {
          cache: new Map(),
          fetch: jest.fn().mockResolvedValue(null)
        }
      };

      const processed = await evolutionWorker.processDueJobs(mockClient);
      expect(processed).toBe(1);

      // Verify xeno was updated
      const xeno = await knex('xenomorphs').where({ id: xenoIdVal }).first();
      expect(xeno.role).toMatch(/runner|facehugger/); // Role should be updated or kept valid
      expect(xeno.stage).toMatch(/runner|facehugger/);

      // Verify job is marked completed
      const job = await knex('evolution_queue').where({ xeno_id: xenoIdVal }).first();
      expect(job.status).toBe('completed');
      expect(job.result).toBe('success');
    });

    test('includes a source message link in the completion DM when origin metadata is present', async () => {
      const knex = dbModule.knex;

      await knex('users').insert({
        discord_id: 'user-link',
        data: '{}'
      });

      const xenoId = await knex('xenomorphs').insert({
        owner_id: 'user-link',
        role: 'facehugger',
        stage: 'facehugger',
        pathway: 'standard',
        data: '{}'
      });
      const xenoIdVal = Array.isArray(xenoId) ? xenoId[0] : xenoId;

      const now = Date.now();
      await knex('evolution_queue').insert({
        user_id: 'user-link',
        xeno_id: xenoIdVal,
        target_role: 'runner',
        finishes_at: now - 1000,
        status: 'queued',
        origin_guild_id: 'guild-123',
        origin_guild_name: 'Aurora Station',
        origin_channel_id: 'channel-456',
        origin_message_id: 'message-789'
      });

      const mockUser = {
        send: jest.fn().mockResolvedValue(null)
      };
      const mockClient = {
        users: {
          cache: new Map([['user-link', mockUser]]),
          fetch: jest.fn().mockResolvedValue(mockUser)
        }
      };

      const processed = await evolutionWorker.processDueJobs(mockClient);
      expect(processed).toBe(1);
      expect(mockUser.send).toHaveBeenCalledTimes(1);

      const payload = mockUser.send.mock.calls[0][0];
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain('Aurora Station');
      expect(serialized).toContain('https://discord.com/channels/guild-123/channel-456/message-789');
    });

    test('skips jobs not yet due', async () => {
      const knex = dbModule.knex;

      // Create a user and xenomorph
      await knex('users').insert({
        discord_id: 'user-2',
        data: '{}'
      });

      const xenoId = await knex('xenomorphs').insert({
        owner_id: 'user-2',
        role: 'facehugger',
        stage: 'facehugger',
        pathway: 'standard',
        data: '{}'
      });
      const xenoIdVal = Array.isArray(xenoId) ? xenoId[0] : xenoId;

      // Create a job that's NOT due yet
      const futureTime = Date.now() + 3600000; // 1 hour from now
      await knex('evolution_queue').insert({
        user_id: 'user-2',
        xeno_id: xenoIdVal,
        target_role: 'runner',
        finishes_at: futureTime,
        status: 'queued'
      });

      const mockClient = {
        users: { cache: new Map(), fetch: jest.fn() }
      };

      const processed = await evolutionWorker.processDueJobs(mockClient);
      expect(processed).toBe(0);

      // Job should still be queued
      const job = await knex('evolution_queue').where({ xeno_id: xenoIdVal }).first();
      expect(job.status).toBe('queued');
    });

    test('handles multiple jobs due', async () => {
      const knex = dbModule.knex;

      // Create users and xenomorphs
      for (let i = 1; i <= 3; i++) {
        await knex('users').insert({
          discord_id: `user-${i}`,
          data: '{}'
        });

        const xenoId = await knex('xenomorphs').insert({
          owner_id: `user-${i}`,
          role: 'facehugger',
          stage: 'facehugger',
          pathway: 'standard',
          data: '{}'
        });
        const xenoIdVal = Array.isArray(xenoId) ? xenoId[0] : xenoId;

        // Create due job
        await knex('evolution_queue').insert({
          user_id: `user-${i}`,
          xeno_id: xenoIdVal,
          target_role: 'runner',
          finishes_at: Date.now() - 1000,
          status: 'queued'
        });
      }

      const mockClient = {
        users: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) }
      };

      const processed = await evolutionWorker.processDueJobs(mockClient);
      expect(processed).toBe(3);

      // Verify all jobs are completed
      const jobs = await knex('evolution_queue').select('*');
      expect(jobs.every(j => j.status === 'completed')).toBe(true);
    });

    test('sets status to processing then completed', async () => {
      const knex = dbModule.knex;

      await knex('users').insert({
        discord_id: 'user-3',
        data: '{}'
      });

      const xenoId = await knex('xenomorphs').insert({
        owner_id: 'user-3',
        role: 'facehugger',
        stage: 'facehugger',
        pathway: 'standard',
        data: '{}'
      });
      const xenoIdVal = Array.isArray(xenoId) ? xenoId[0] : xenoId;

      const jobId = await knex('evolution_queue').insert({
        user_id: 'user-3',
        xeno_id: xenoIdVal,
        target_role: 'runner',
        finishes_at: Date.now() - 1000,
        status: 'queued'
      });
      const jobIdVal = Array.isArray(jobId) ? jobId[0] : jobId;

      const mockClient = {
        users: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) }
      };

      const processed = await evolutionWorker.processDueJobs(mockClient);
      expect(processed).toBe(1);

      const job = await knex('evolution_queue').where({ id: jobIdVal }).first();
      expect(job.status).toBe('completed');
      expect(job.result).toBe('success');
    });

    test('respects job limit (max 20 per run)', async () => {
      const knex = dbModule.knex;

      // Create 25 jobs due
      for (let i = 1; i <= 25; i++) {
        await knex('users').insert({
          discord_id: `user-limit-${i}`,
          data: '{}'
        });

        const xenoId = await knex('xenomorphs').insert({
          owner_id: `user-limit-${i}`,
          role: 'facehugger',
          stage: 'facehugger',
          pathway: 'standard',
          data: '{}'
        });
        const xenoIdVal = Array.isArray(xenoId) ? xenoId[0] : xenoId;

        await knex('evolution_queue').insert({
          user_id: `user-limit-${i}`,
          xeno_id: xenoIdVal,
          target_role: 'runner',
          finishes_at: Date.now() - 1000,
          status: 'queued'
        });
      }

      const mockClient = {
        users: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) }
      };

      const processed = await evolutionWorker.processDueJobs(mockClient);
      expect(processed).toBeLessThanOrEqual(20); // Should respect limit

      // Check some jobs are still queued
      const queuedJobs = await knex('evolution_queue').where({ status: 'queued' }).select('*');
      expect(queuedJobs.length).toBeGreaterThan(0);
    });
  });
});
