const { safeJsonParse, safeLogMemory, safeAwait, extractErrorInfo, safeExecute } = require('../src/lib/safeUtils');

describe('safeUtils', () => {
  describe('safeJsonParse', () => {
    test('parses valid JSON string', () => {
      const json = '{"key": "value", "num": 42}';
      const result = safeJsonParse(json, {});
      expect(result).toEqual({ key: 'value', num: 42 });
    });

    test('returns default value for invalid JSON', () => {
      const json = '{invalid json}';
      const defaultVal = { fallback: true };
      const result = safeJsonParse(json, defaultVal);
      expect(result).toEqual(defaultVal);
    });

    test('returns default value for null/undefined', () => {
      expect(safeJsonParse(null, { default: 1 })).toEqual({ default: 1 });
      expect(safeJsonParse(undefined, { default: 2 })).toEqual({ default: 2 });
    });

    test('handles empty values', () => {
      expect(safeJsonParse('', {})).toEqual({});
    });

    test('logs errors when logger provided', () => {
      const mockLogger = { warn: jest.fn() };
      safeJsonParse('bad json', {}, mockLogger);
      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed parsing JSON'),
        expect.any(Object)
      );
    });
  });

  describe('safeLogMemory', () => {
    test('returns null when ENABLE_MEMORY_DIAGNOSTICS not set', () => {
      const originalEnv = process.env.ENABLE_MEMORY_DIAGNOSTICS;
      delete process.env.ENABLE_MEMORY_DIAGNOSTICS;

      const mockLogger = { info: jest.fn() };
      const result = safeLogMemory(mockLogger, 'test');

      expect(result).toBeNull();
      expect(mockLogger.info).not.toHaveBeenCalled();

      process.env.ENABLE_MEMORY_DIAGNOSTICS = originalEnv;
    });

    test('logs memory when ENABLE_MEMORY_DIAGNOSTICS=1', () => {
      const originalEnv = process.env.ENABLE_MEMORY_DIAGNOSTICS;
      process.env.ENABLE_MEMORY_DIAGNOSTICS = '1';

      const mockLogger = { info: jest.fn() };
      const result = safeLogMemory(mockLogger, 'test memory');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'test memory',
        expect.objectContaining({
          heapUsedMb: expect.any(Number),
          rssMb: expect.any(Number)
        })
      );
      expect(result).toHaveProperty('heapUsedMb');
      expect(result).toHaveProperty('rssMb');

      process.env.ENABLE_MEMORY_DIAGNOSTICS = originalEnv;
    });

    test('returns null when logger is null', () => {
      const originalEnv = process.env.ENABLE_MEMORY_DIAGNOSTICS;
      process.env.ENABLE_MEMORY_DIAGNOSTICS = '1';

      const result = safeLogMemory(null, 'test');
      expect(result).toBeNull();

      process.env.ENABLE_MEMORY_DIAGNOSTICS = originalEnv;
    });
  });

  describe('extractErrorInfo', () => {
    test('extracts stack from Error objects', () => {
      const err = new Error('test error');
      expect(extractErrorInfo(err)).toContain('test error');
    });

    test('returns null for null error', () => {
      expect(extractErrorInfo(null)).toBeNull();
    });

    test('returns error string representation', () => {
      const result = extractErrorInfo('simple error message');
      expect(result).toBe('simple error message');
    });
  });

  describe('safeExecute', () => {
    test('executes function and returns result', () => {
      const result = safeExecute(() => 42, null);
      expect(result).toBe(42);
    });

    test('returns default value on error', () => {
      const fn = () => {
        throw new Error('test error');
      };
      const result = safeExecute(fn, 'default', null);
      expect(result).toBe('default');
    });

    test('logs errors when logger provided', () => {
      const mockLogger = { warn: jest.fn() };
      const fn = () => {
        throw new Error('test error');
      };
      safeExecute(fn, null, mockLogger, 'test operation');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'test operation',
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('safeAwait', () => {
    test('resolves promise successfully', async () => {
      const promise = Promise.resolve(42);
      const result = await safeAwait(promise, null, 'test', false);
      expect(result).toBe(42);
    });

    test('returns null on promise rejection when shouldThrow=false', async () => {
      const promise = Promise.reject(new Error('test error'));
      const result = await safeAwait(promise, null, 'test', false);
      expect(result).toBeNull();
    });

    test('rethrows error when shouldThrow=true', async () => {
      const promise = Promise.reject(new Error('test error'));
      await expect(safeAwait(promise, null, 'test', true)).rejects.toThrow('test error');
    });

    test('logs errors when logger provided', async () => {
      const mockLogger = { warn: jest.fn() };
      const promise = Promise.reject(new Error('test error'));
      await safeAwait(promise, mockLogger, 'test', false);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });
});
