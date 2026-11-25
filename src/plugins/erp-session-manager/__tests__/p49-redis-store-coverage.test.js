'use strict';

/**
 * P49 — RedisStore & password-validator coverage tests
 * Target: bring redis-store.js new_coverage from 14.6% to >80%
 *         and password-validator.js from 0% to >80%
 */

const RedisStore = require('../server/services/store/redis-store');

// ---------------------------------------------------------------------------
// Helpers — minimal Redis client mock
// ---------------------------------------------------------------------------
function makePipeline(responses = []) {
  const ops = [];
  const pipeline = {
    set: jest.fn(() => pipeline),
    get: jest.fn(() => pipeline),
    del: jest.fn(() => pipeline),
    sadd: jest.fn(() => pipeline),
    srem: jest.fn(() => pipeline),
    exec: jest.fn(() => Promise.resolve(responses)),
    _ops: ops,
  };
  return pipeline;
}

function makeClient(overrides = {}) {
  const pipelineInstance = makePipeline([[null, 1]]);
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue(['0', []]),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    pipeline: jest.fn(() => makePipeline([[null, 1]])),
    ...overrides,
  };
}

const mockStrapi = { log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } };

describe('P49 — RedisStore Coverage', () => {
  describe('_log', () => {
    test('uses strapi.log when available', () => {
      const store = new RedisStore({}, mockStrapi);
      store._log('info', 'test message');
      expect(mockStrapi.log.info).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    test('falls back to console when strapi not provided', () => {
      const store = new RedisStore({}, null);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      store._log('debug', 'debug message');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('falls back to console.warn for warn level', () => {
      const store = new RedisStore({}, null);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      store._log('warn', 'warn message');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('_ttlSeconds', () => {
    test('returns seconds from explicit ms', () => {
      const store = new RedisStore({}, mockStrapi);
      expect(store._ttlSeconds(60000)).toBe(60);
    });

    test('returns minimum of 1 for very small ms', () => {
      const store = new RedisStore({}, mockStrapi);
      expect(store._ttlSeconds(500)).toBe(1);
    });

    test('falls back to _parentConfig.tokens.refreshTokenTtl', () => {
      const store = new RedisStore({ _parentConfig: { tokens: { refreshTokenTtl: 3600 } } }, mockStrapi);
      expect(store._ttlSeconds(undefined)).toBe(3600);
    });

    test('falls back to 28800 default when no config', () => {
      const store = new RedisStore({}, mockStrapi);
      expect(store._ttlSeconds(undefined)).toBe(28800);
    });

    test('falls back to 28800 when refreshTokenTtl is 0 or negative', () => {
      const store = new RedisStore({ _parentConfig: { tokens: { refreshTokenTtl: 0 } } }, mockStrapi);
      expect(store._ttlSeconds(undefined)).toBe(28800);
    });
  });

  describe('disconnect', () => {
    test('calls quit and sets _client to null', async () => {
      const store = new RedisStore({}, mockStrapi);
      const client = makeClient();
      store._client = client;
      await store.disconnect();
      expect(client.quit).toHaveBeenCalled();
      expect(store._client).toBeNull();
    });

    test('no-op when _client is null', async () => {
      const store = new RedisStore({}, mockStrapi);
      await expect(store.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('get', () => {
    test('returns deserialized record', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({ get: jest.fn().mockResolvedValue(JSON.stringify({ userId: 1 })) });
      const result = await store.get('session-1');
      expect(result).toEqual({ userId: 1 });
    });

    test('returns null for missing key', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({ get: jest.fn().mockResolvedValue(null) });
      const result = await store.get('missing');
      expect(result).toBeNull();
    });

    test('returns null for invalid JSON', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({ get: jest.fn().mockResolvedValue('not-json') });
      const result = await store.get('bad');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    test('calls pipeline.set and pipeline.sadd with correct args', async () => {
      const store = new RedisStore({}, mockStrapi);
      const pipeline = makePipeline([[null, 'OK'], [null, 1]]);
      store._client = makeClient({ pipeline: jest.fn(() => pipeline) });
      await store.set('sid-1', { userId: 42, data: 'test' }, 60000);
      expect(pipeline.set).toHaveBeenCalledWith('erp:session:sid-1', expect.any(String), 'EX', 60);
      expect(pipeline.sadd).toHaveBeenCalledWith('erp:user-sessions:42', 'sid-1');
      expect(pipeline.exec).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    test('fetches session and removes from index', async () => {
      const store = new RedisStore({}, mockStrapi);
      const sessionData = JSON.stringify({ userId: 5 });
      const pipeline = makePipeline([[null, 1], [null, 1]]);
      store._client = makeClient({
        get: jest.fn().mockResolvedValue(sessionData),
        pipeline: jest.fn(() => pipeline),
      });
      await store.delete('sid-to-delete');
      expect(pipeline.del).toHaveBeenCalledWith('erp:session:sid-to-delete');
      expect(pipeline.srem).toHaveBeenCalledWith('erp:user-sessions:5', 'sid-to-delete');
    });

    test('no-op when session not found', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({ get: jest.fn().mockResolvedValue(null) });
      await expect(store.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('getByUser', () => {
    test('returns empty array when no sessions', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({ smembers: jest.fn().mockResolvedValue([]) });
      const result = await store.getByUser(1);
      expect(result).toEqual([]);
    });

    test('returns deserialized records for user', async () => {
      const store = new RedisStore({}, mockStrapi);
      const record = { userId: 1, sessionId: 's1' };
      const pipeline = makePipeline([[null, JSON.stringify(record)]]);
      store._client = makeClient({
        smembers: jest.fn().mockResolvedValue(['s1']),
        pipeline: jest.fn(() => pipeline),
      });
      const result = await store.getByUser(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(record);
    });

    test('cleans up stale index entries', async () => {
      const store = new RedisStore({}, mockStrapi);
      const pipeline = makePipeline([[null, null]]); // null = expired key
      const sremMock = jest.fn().mockResolvedValue(1);
      store._client = makeClient({
        smembers: jest.fn().mockResolvedValue(['stale-s1']),
        pipeline: jest.fn(() => pipeline),
        srem: sremMock,
      });
      const result = await store.getByUser(99);
      expect(result).toHaveLength(0);
      // srem called asynchronously to clean up stale IDs
      await new Promise((r) => setTimeout(r, 10));
      expect(sremMock).toHaveBeenCalledWith('erp:user-sessions:99', 'stale-s1');
    });
  });

  describe('deleteByUser', () => {
    test('returns 0 when no sessions exist', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({ smembers: jest.fn().mockResolvedValue([]) });
      const count = await store.deleteByUser(1);
      expect(count).toBe(0);
    });

    test('deletes all sessions and the user index', async () => {
      const store = new RedisStore({}, mockStrapi);
      const pipeline = makePipeline([[null, 1], [null, 1]]);
      store._client = makeClient({
        smembers: jest.fn().mockResolvedValue(['s1']),
        pipeline: jest.fn(() => pipeline),
      });
      const count = await store.deleteByUser(5);
      expect(count).toBe(1);
      expect(pipeline.del).toHaveBeenCalled();
    });
  });

  describe('deleteMany', () => {
    test('returns 0 for empty array', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient();
      const count = await store.deleteMany([]);
      expect(count).toBe(0);
    });

    test('deletes existing sessions and skips missing', async () => {
      const store = new RedisStore({}, mockStrapi);
      const record = { userId: 3 };
      const getPipeline = makePipeline([[null, JSON.stringify(record)], [null, null]]);
      const delPipeline = makePipeline([[null, 1], [null, 1]]);
      let callCount = 0;
      store._client = makeClient({
        pipeline: jest.fn(() => {
          callCount++;
          return callCount === 1 ? getPipeline : delPipeline;
        }),
      });
      const count = await store.deleteMany(['s-exists', 's-missing']);
      expect(count).toBe(1);
    });
  });

  describe('_filterRecords', () => {
    const now = Date.now();
    const records = [
      { userId: 1, ipAddress: '1.2.3.4', isRevoked: false, expiresAt: now + 60000, anomalyFlags: [] },
      { userId: 2, ipAddress: '5.6.7.8', isRevoked: true, expiresAt: now + 60000, anomalyFlags: [] },
      { userId: 3, ipAddress: '1.2.3.4', isRevoked: false, expiresAt: now - 1000, anomalyFlags: [] },
      { userId: 4, ipAddress: '9.9.9.9', isRevoked: false, expiresAt: now + 100, anomalyFlags: ['ip_change'] },
    ];

    test('filters by userId', () => {
      const store = new RedisStore({}, mockStrapi);
      const result = store._filterRecords(records, { userId: 1 }, now);
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe(1);
    });

    test('filters by ip', () => {
      const store = new RedisStore({}, mockStrapi);
      const result = store._filterRecords(records, { ip: '1.2.3.4' }, now);
      expect(result).toHaveLength(2);
    });

    test('filters by status=active', () => {
      const store = new RedisStore({}, mockStrapi);
      const result = store._filterRecords(records, { status: 'active' }, now);
      // userId 1 (not revoked, not expired), userId 4 (not revoked, not expired)
      expect(result.every((r) => !r.isRevoked && r.expiresAt > now)).toBe(true);
    });

    test('filters by status=anomaly', () => {
      const store = new RedisStore({}, mockStrapi);
      const result = store._filterRecords(records, { status: 'anomaly' }, now);
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe(4);
    });

    test('filters by status=expiring', () => {
      const store = new RedisStore({}, mockStrapi);
      // userId 4 has expiresAt = now + 100ms, which is less than EXPIRING_SOON_MS (30 min)
      const result = store._filterRecords(records, { status: 'expiring' }, now);
      expect(result.some((r) => r.userId === 4)).toBe(true);
    });

    test('returns empty array for unknown status', () => {
      const store = new RedisStore({}, mockStrapi);
      const result = store._filterRecords(records, { status: 'invalid' }, now);
      expect(result).toHaveLength(0);
    });
  });

  describe('_sortRecords', () => {
    const records = [
      { issuedAt: 200, lastActive: 1000 },
      { issuedAt: 100, lastActive: 500 },
      { issuedAt: 300, lastActive: 200 },
    ];

    test('sorts by issuedAt asc', () => {
      const store = new RedisStore({}, mockStrapi);
      const sorted = store._sortRecords(records, 'issuedAt', 'asc');
      expect(sorted[0].issuedAt).toBe(100);
      expect(sorted[2].issuedAt).toBe(300);
    });

    test('sorts by issuedAt desc', () => {
      const store = new RedisStore({}, mockStrapi);
      const sorted = store._sortRecords(records, 'issuedAt', 'desc');
      expect(sorted[0].issuedAt).toBe(300);
    });

    test('sorts by lastActive', () => {
      const store = new RedisStore({}, mockStrapi);
      const sorted = store._sortRecords(records, 'lastActive', 'asc');
      expect(sorted[0].lastActive).toBe(200);
    });

    test('returns records unchanged for unknown sortBy', () => {
      const store = new RedisStore({}, mockStrapi);
      const sorted = store._sortRecords(records, 'unknownField', 'asc');
      expect(sorted).toHaveLength(3);
    });

    test('returns records unchanged when sortBy is undefined', () => {
      const store = new RedisStore({}, mockStrapi);
      const sorted = store._sortRecords(records, undefined, 'asc');
      expect(sorted).toHaveLength(3);
    });
  });

  describe('listAll', () => {
    test('returns empty result when no session keys', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._scanAllSessionKeys = jest.fn().mockResolvedValue([]);
      const result = await store.listAll();
      expect(result).toEqual({ records: [], total: 0 });
    });

    test('returns paginated records', async () => {
      const store = new RedisStore({}, mockStrapi);
      const records = [
        { userId: 1, issuedAt: 100 },
        { userId: 2, issuedAt: 200 },
        { userId: 3, issuedAt: 300 },
      ];
      store._scanAllSessionKeys = jest.fn().mockResolvedValue(['k1', 'k2', 'k3']);
      const pipeline = makePipeline(records.map((r) => [null, JSON.stringify(r)]));
      store._client = makeClient({ pipeline: jest.fn(() => pipeline) });

      const result = await store.listAll({ page: 1, pageSize: 2, sortBy: 'issuedAt', sortOrder: 'desc' });
      expect(result.total).toBe(3);
      expect(result.records).toHaveLength(2);
      // sorted desc, first should be userId 3
      expect(result.records[0].userId).toBe(3);
    });

    test('skips null/error records from pipeline', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._scanAllSessionKeys = jest.fn().mockResolvedValue(['k1', 'k2']);
      const pipeline = makePipeline([[null, null], [new Error('fail'), null]]);
      store._client = makeClient({ pipeline: jest.fn(() => pipeline) });

      const result = await store.listAll();
      expect(result.total).toBe(0);
      expect(result.records).toHaveLength(0);
    });
  });

  describe('updateLastActive', () => {
    test('updates lastActive field preserving TTL', async () => {
      const store = new RedisStore({}, mockStrapi);
      const record = { userId: 7, lastActive: 0 };
      store._client = makeClient({
        get: jest.fn().mockResolvedValue(JSON.stringify(record)),
        ttl: jest.fn().mockResolvedValue(3600),
        set: jest.fn().mockResolvedValue('OK'),
      });
      await store.updateLastActive('sid-7', 9999);
      expect(store._client.set).toHaveBeenCalledWith(
        'erp:session:sid-7',
        expect.stringContaining('"lastActive":9999'),
        'EX',
        3600
      );
    });

    test('updates without TTL when TTL is -1', async () => {
      const store = new RedisStore({}, mockStrapi);
      const record = { userId: 8, lastActive: 0 };
      store._client = makeClient({
        get: jest.fn().mockResolvedValue(JSON.stringify(record)),
        ttl: jest.fn().mockResolvedValue(-1),
        set: jest.fn().mockResolvedValue('OK'),
      });
      await store.updateLastActive('sid-8', 5555);
      expect(store._client.set).toHaveBeenCalledWith(
        'erp:session:sid-8',
        expect.stringContaining('"lastActive":5555')
      );
    });

    test('no-op when session not found', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({
        get: jest.fn().mockResolvedValue(null),
        ttl: jest.fn().mockResolvedValue(3600),
        set: jest.fn(),
      });
      await store.updateLastActive('missing', 1234);
      expect(store._client.set).not.toHaveBeenCalled();
    });
  });

  describe('markRevoked', () => {
    test('marks session as revoked preserving TTL', async () => {
      const store = new RedisStore({}, mockStrapi);
      const record = { userId: 9, isRevoked: false };
      store._client = makeClient({
        get: jest.fn().mockResolvedValue(JSON.stringify(record)),
        ttl: jest.fn().mockResolvedValue(1800),
        set: jest.fn().mockResolvedValue('OK'),
      });
      await store.markRevoked('sid-9');
      expect(store._client.set).toHaveBeenCalledWith(
        'erp:session:sid-9',
        expect.stringContaining('"isRevoked":true'),
        'EX',
        1800
      );
    });

    test('marks revoked without TTL when TTL <= 0', async () => {
      const store = new RedisStore({}, mockStrapi);
      const record = { userId: 10, isRevoked: false };
      store._client = makeClient({
        get: jest.fn().mockResolvedValue(JSON.stringify(record)),
        ttl: jest.fn().mockResolvedValue(-2),
        set: jest.fn().mockResolvedValue('OK'),
      });
      await store.markRevoked('sid-10');
      expect(store._client.set).toHaveBeenCalledWith(
        'erp:session:sid-10',
        expect.stringContaining('"isRevoked":true')
      );
    });

    test('no-op when session not found', async () => {
      const store = new RedisStore({}, mockStrapi);
      store._client = makeClient({
        get: jest.fn().mockResolvedValue(null),
        ttl: jest.fn().mockResolvedValue(3600),
        set: jest.fn(),
      });
      await store.markRevoked('ghost-session');
      expect(store._client.set).not.toHaveBeenCalled();
    });
  });

  describe('_scanAllSessionKeys', () => {
    test('uses scanStream for standard client', async () => {
      const store = new RedisStore({}, mockStrapi);
      const { EventEmitter } = require('events');
      const stream = new EventEmitter();
      store._client = makeClient({
        scanStream: jest.fn(() => stream),
        constructor: { name: 'Redis' },
      });
      // Simulate scan returning keys then ending
      const promise = store._scanAllSessionKeys();
      stream.emit('data', ['erp:session:a', 'erp:session:b']);
      stream.emit('end');
      const keys = await promise;
      expect(keys).toContain('erp:session:a');
      expect(keys).toContain('erp:session:b');
    });

    test('handles scan error', async () => {
      const store = new RedisStore({}, mockStrapi);
      const { EventEmitter } = require('events');
      const stream = new EventEmitter();
      store._client = makeClient({ scanStream: jest.fn(() => stream) });
      const promise = store._scanAllSessionKeys();
      stream.emit('error', new Error('scan failed'));
      await expect(promise).rejects.toThrow('scan failed');
    });
  });
});
