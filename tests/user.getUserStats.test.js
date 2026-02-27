const { getUserStats } = require('../src/models/user');

describe('getUserStats', () => {
  test('returns zeros/nulls for empty stats', () => {
    const user = { data: {} };
    const s = getUserStats(user);
    expect(s).toEqual({ catches: 0, fastest: null, slowest: null, avg: null, purrfect: 0 });
  });

  test('computes fastest/slowest/avg correctly', () => {
    const user = { data: { stats: { catches: 3, catchTimes: [1500, 2500, 1000], purrfect: 1 } } };
    const s = getUserStats(user);
    expect(s.catches).toBe(3);
    expect(s.purrfect).toBe(1);
    expect(s.fastest).toBe(1000);
    expect(s.slowest).toBe(2500);
    expect(s.avg).toBeCloseTo((1500 + 2500 + 1000) / 3);
  });

  test('handles single catch time', () => {
    const user = { data: { stats: { catches: 1, catchTimes: [2000] } } };
    const s = getUserStats(user);
    expect(s.catches).toBe(1);
    expect(s.fastest).toBe(2000);
    expect(s.slowest).toBe(2000);
    expect(s.avg).toBe(2000);
  });
});
