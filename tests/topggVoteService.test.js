const crypto = require('crypto');
const topggVoteService = require('../src/services/topggVoteService');

describe('topggVoteService helpers', () => {
  test('extractVoteUserId normalizes common payload shapes', () => {
    expect(topggVoteService.extractVoteUserId({ data: { user: { id: '123' } } })).toBe('123');
    expect(topggVoteService.extractVoteUserId({ data: { user_id: 456 } })).toBe('456');
    expect(topggVoteService.extractVoteUserId({ data: { user: { platform_id: '789' } } })).toBe('789');
  });

  test('isVotePayload accepts the new Top.gg webhook event names', () => {
    expect(topggVoteService.isVotePayload({ type: 'vote.create' })).toBe(true);
    expect(topggVoteService.isVotePayload({ type: 'webhook.test' })).toBe(true);
    expect(topggVoteService.isVotePayload({ type: 'something-else' })).toBe(false);
  });

  test('verifyTopggSignature validates the signed raw body', () => {
    const secret = 'whs_test_secret';
    const rawBody = Buffer.from('{"type":"vote.create"}', 'utf8');
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    const header = `t=${timestamp},v1=${signature}`;

    expect(topggVoteService.parseTopggSignature(header)).toEqual({ timestamp, signature });
    expect(topggVoteService.verifyTopggSignature(rawBody, header, secret)).toBe(true);
    expect(topggVoteService.verifyTopggSignature(rawBody, header, 'wrong-secret')).toBe(false);
  });

  test('buildVoteDmContent includes the vote url and reminder copy', () => {
    const voteAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const content = topggVoteService.buildVoteDmContent({ nextVoteAt: voteAt });

    expect(content).toContain('Thanks for voting for Xeno Bot on Top.gg.');
    expect(content).toContain('Vote here: https://top.gg/bot/1476427270326583306/vote');
    expect(content).toContain('I will DM you again when the next vote reminder is ready.');
  });

  test('extractVoteReminderAt prefers expires_at from the webhook payload', () => {
    const expiresAt = '2026-01-01T18:34:56.789Z';
    const payload = {
      type: 'vote.create',
      data: {
        created_at: '2026-01-01T12:34:56.789Z',
        expires_at: expiresAt,
      },
    };

    expect(topggVoteService.extractVoteReminderAt(payload)).toBe(new Date(expiresAt).getTime());
  });
});