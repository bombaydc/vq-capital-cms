'use strict';

const crypto = require('crypto');
const cryptoUtils = require('./crypto');

describe('CryptoUtils', () => {
  // ─── generateSessionId ────────────────────────────────────────────────────

  describe('generateSessionId()', () => {
    it('returns a 32-character hex string (128-bit)', () => {
      const id = cryptoUtils.generateSessionId();
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(32);
      expect(/^[0-9a-f]{32}$/.test(id)).toBe(true);
    });

    it('produces unique values on successive calls', () => {
      const ids = new Set(Array.from({ length: 100 }, () => cryptoUtils.generateSessionId()));
      expect(ids.size).toBe(100);
    });
  });

  // ─── generateRefreshToken ─────────────────────────────────────────────────

  describe('generateRefreshToken()', () => {
    it('returns a 64-character hex string (256-bit)', () => {
      const token = cryptoUtils.generateRefreshToken();
      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it('produces unique values on successive calls', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => cryptoUtils.generateRefreshToken()));
      expect(tokens.size).toBe(100);
    });
  });

  // ─── hashToken ────────────────────────────────────────────────────────────

  describe('hashToken(raw)', () => {
    it('returns a 64-character hex string (SHA-256 digest)', () => {
      const hash = cryptoUtils.hashToken('some-raw-token');
      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('matches the expected SHA-256 digest for a known input', () => {
      const raw = 'test-token-value';
      const expected = crypto.createHash('sha256').update(raw).digest('hex');
      expect(cryptoUtils.hashToken(raw)).toBe(expected);
    });

    it('is deterministic — same input always produces same hash', () => {
      const raw = 'deterministic-input';
      expect(cryptoUtils.hashToken(raw)).toBe(cryptoUtils.hashToken(raw));
    });

    it('produces different hashes for different inputs', () => {
      expect(cryptoUtils.hashToken('token-a')).not.toBe(cryptoUtils.hashToken('token-b'));
    });

    it('hashes a generated refresh token to a 64-char hex string', () => {
      const raw = cryptoUtils.generateRefreshToken();
      const hash = cryptoUtils.hashToken(raw);
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });
  });
});
