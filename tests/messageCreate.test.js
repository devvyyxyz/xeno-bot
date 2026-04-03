describe('messageCreate event', () => {
  function makeMessage(content) {
    return {
      content,
      author: { id: 'user-1', bot: false },
      guild: { id: 'guild-1' },
      channel: { id: 'channel-1' },
      reply: jest.fn().mockResolvedValue(null),
    };
  }

  beforeEach(() => {
    jest.resetModules();
  });

  test('initializes user before spawn handling for egg attempts', async () => {
    const calls = [];
    const findOrCreate = jest.fn().mockImplementation(async () => {
      calls.push('init');
      return { id: 1, discord_id: 'user-1', data: {} };
    });
    const handleMessage = jest.fn().mockImplementation(async () => {
      calls.push('spawn');
      return false;
    });

    jest.doMock('../src/utils', () => ({
      logger: { get: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
      fallbackLogger: { warn: jest.fn(), error: jest.fn() },
    }));
    jest.doMock('../src/spawnManager', () => ({
      handleMessage,
      activeEggs: new Map(),
    }));
    jest.doMock('../src/models/user', () => ({ findOrCreate }));

    const event = require('../src/events/messageCreate');
    const message = makeMessage('egg');
    const client = { config: { prefix: '!' }, commands: new Map() };

    await event.execute(message, client);

    expect(findOrCreate).toHaveBeenCalledWith('user-1');
    expect(handleMessage).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['init', 'spawn']);
  });

  test('does not initialize user for non-egg non-command message', async () => {
    const findOrCreate = jest.fn();
    const handleMessage = jest.fn().mockResolvedValue(false);

    jest.doMock('../src/utils', () => ({
      logger: { get: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
      fallbackLogger: { warn: jest.fn(), error: jest.fn() },
    }));
    jest.doMock('../src/spawnManager', () => ({
      handleMessage,
      activeEggs: new Map(),
    }));
    jest.doMock('../src/models/user', () => ({ findOrCreate }));

    const event = require('../src/events/messageCreate');
    const message = makeMessage('hello there');
    const client = { config: { prefix: '!' }, commands: new Map() };

    await event.execute(message, client);

    expect(findOrCreate).not.toHaveBeenCalled();
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
});