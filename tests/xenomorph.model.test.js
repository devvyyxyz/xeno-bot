const dbModule = require('../src/db');
const xenoModel = require('../src/models/xenomorph');

beforeAll(async () => {
  await dbModule.migrate();
});

afterAll(async () => {
  const k = dbModule.knex;
  try { await k.destroy(); } catch (_) {}
});

test('listByOwner returns unassigned xenos when includeUnassigned=true', async () => {
  const knex = dbModule.knex;
  // create a hive with guild_id
  const hiveId = await knex('hives').insert({ user_id: 'u1', guild_id: 'g1', name: 'h1' });
  const hiveIdVal = Array.isArray(hiveId) ? hiveId[0] : hiveId;

  // insert xenos: one with hive_id, one with no hive/guild
  const x1 = await knex('xenomorphs').insert({ owner_id: 'u1', hive_id: hiveIdVal, role: 'facehugger', stage: 'facehugger' });
  const x2 = await knex('xenomorphs').insert({ owner_id: 'u1', hive_id: null, role: 'egg', stage: 'egg' });
  const x1Id = Array.isArray(x1) ? x1[0] : x1;
  const x2Id = Array.isArray(x2) ? x2[0] : x2;

  const listScoped = await xenoModel.listByOwner('u1', 'g1', false);
  expect(listScoped.some(x => x.id === x1Id)).toBe(true);
  expect(listScoped.some(x => x.id === x2Id)).toBe(false);

  const listUnassigned = await xenoModel.listByOwner('u1', 'g1', true);
  expect(listUnassigned.some(x => x.id === x1Id)).toBe(true);
  expect(listUnassigned.some(x => x.id === x2Id)).toBe(true);
});

test('getByIdScoped respects guild_id via hive join', async () => {
  const knex = dbModule.knex;
  const hiveId = await knex('hives').insert({ user_id: 'u2', guild_id: 'g2', name: 'h2' });
  const hiveIdVal = Array.isArray(hiveId) ? hiveId[0] : hiveId;
  const x = await knex('xenomorphs').insert({ owner_id: 'u2', hive_id: hiveIdVal, role: 'facehugger', stage: 'facehugger' });
  const xId = Array.isArray(x) ? x[0] : x;

  const found = await xenoModel.getByIdScoped(xId, 'g2');
  expect(found).not.toBeNull();
  expect(found.id).toBe(xId);

  const notFound = await xenoModel.getByIdScoped(xId, 'other-guild');
  expect(notFound).toBeNull();
});
