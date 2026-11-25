'use strict';

/**
 * Property 50 — Lead PII encryption at rest (AES-256-GCM)
 *
 * Properties:
 *   A) Round-trip identity: decryptPii(encryptPii(x)) === x for any string.
 *   B) Wire format: every stored value carries the `v2:` prefix, and the
 *      ciphertext never contains the plaintext.
 *   C) IV uniqueness: encrypting the same plaintext twice never produces the
 *      same blob (a fixed IV would break GCM's confidentiality guarantee).
 *   D) Authentication: any mutation of the blob is detected — decryptPii
 *      returns null rather than silently yielding corrupt plaintext.
 *   E) Dual read: readPii() routes `v2:` to AES and everything else to the
 *      legacy RSA path, so pre-migration rows keep working.
 *
 * Context: replaces RSA-4096 PKCS#1 v1.5 at rest, which cost ~345-530 ms per
 * field in pure JS (Node >= 20.11.1 blocks the native path per CVE-2023-46809)
 * and blocked the event loop for the whole export.
 */

const fc = require('fast-check');

// A deterministic key for the suite — never a real environment key.
process.env.LEADS_ENCRYPTION_KEY =
  process.env.LEADS_ENCRYPTION_KEY || 'test-only-lead-pii-key-do-not-use-in-any-real-environment';

const {
  encryptPii,
  decryptPii,
  readPii,
  isEncryptedPii,
  VERSION_PREFIX,
} = require('../../../utility/pii-encryption');

// ---------------------------------------------------------------------------
// A) Round-trip identity
// ---------------------------------------------------------------------------

describe('A) Round-trip identity', () => {
  test('A1 (property): any non-empty string survives encrypt -> decrypt unchanged', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), (plaintext) => {
        expect(decryptPii(encryptPii(plaintext))).toBe(plaintext);
        return true;
      }),
      { numRuns: 200 }
    );
  });

  test('A2: realistic PII shapes round-trip exactly', () => {
    for (const v of [
      'Priya Sharma',
      'priya.sharma+leads@example.co.in',
      '9876543210',
      '+91 98765 43210',
      "O'Brien-Smith",
      'Ünïcøde Nâme 中文 العربية',
      'a'.repeat(255),
    ]) {
      expect(decryptPii(encryptPii(v))).toBe(v);
    }
  });

  test('A3: empty-ish inputs store as null rather than an encrypted empty string', () => {
    expect(encryptPii(null)).toBeNull();
    expect(encryptPii(undefined)).toBeNull();
    expect(encryptPii('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B) Wire format
// ---------------------------------------------------------------------------

describe('B) Storage format', () => {
  test('B1 (property): output is always v2:-prefixed and never leaks the plaintext', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4, maxLength: 120 }), (plaintext) => {
        const blob = encryptPii(plaintext);
        expect(blob.startsWith(VERSION_PREFIX)).toBe(true);
        expect(isEncryptedPii(blob)).toBe(true);
        expect(blob).not.toContain(plaintext);
        return true;
      }),
      { numRuns: 100 }
    );
  });

  test('B2: isEncryptedPii only recognises the v2: prefix', () => {
    expect(isEncryptedPii(encryptPii('x'))).toBe(true);
    // A legacy RSA blob is base64 without the prefix.
    expect(isEncryptedPii('Zm9vYmFyYmF6' + 'A'.repeat(600))).toBe(false);
    expect(isEncryptedPii(null)).toBe(false);
    expect(isEncryptedPii(undefined)).toBe(false);
    expect(isEncryptedPii(12345)).toBe(false);
  });

  test('B3: blobs are dramatically smaller than the RSA-4096 ciphertext they replace', () => {
    // RSA-4096 base64 is ~684 chars regardless of input length.
    expect(encryptPii('priya.sharma@example.com').length).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// C) IV uniqueness
// ---------------------------------------------------------------------------

describe('C) IV uniqueness', () => {
  test('C1: the same plaintext encrypts to a different blob every time', () => {
    const blobs = new Set();
    for (let i = 0; i < 500; i++) blobs.add(encryptPii('same-value@example.com'));
    expect(blobs.size).toBe(500);
  });

  test('C2 (property): two encryptions of one value never collide, and both decrypt', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (v) => {
        const a = encryptPii(v);
        const b = encryptPii(v);
        expect(a).not.toBe(b);
        expect(decryptPii(a)).toBe(v);
        expect(decryptPii(b)).toBe(v);
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// D) Authentication / tamper detection
// ---------------------------------------------------------------------------

describe('D) Tamper detection', () => {
  test('D1: flipping any byte of the payload makes decryption fail closed', () => {
    const blob = encryptPii('priya.sharma@example.com');
    const raw = Buffer.from(blob.slice(VERSION_PREFIX.length), 'base64');

    // Sample positions across IV, auth tag and ciphertext.
    const positions = [0, 5, 11, 12, 20, 27, 28, raw.length - 1];
    for (const pos of positions) {
      const mutated = Buffer.from(raw);
      mutated[pos] ^= 0xff;
      const tampered = VERSION_PREFIX + mutated.toString('base64');
      expect(decryptPii(tampered)).toBeNull();
    }
  });

  test('D2: truncated, malformed and non-v2 blobs return null instead of throwing', () => {
    const blob = encryptPii('something');
    expect(decryptPii(VERSION_PREFIX + 'not-valid-base64!!!')).toBeNull();
    expect(decryptPii(VERSION_PREFIX)).toBeNull();
    expect(decryptPii(blob.slice(0, VERSION_PREFIX.length + 8))).toBeNull();
    expect(decryptPii('no-prefix-at-all')).toBeNull();
    expect(decryptPii(null)).toBeNull();
  });

  test('D3: a blob encrypted under a different key does not decrypt', () => {
    jest.resetModules();
    const ORIGINAL = process.env.LEADS_ENCRYPTION_KEY;
    process.env.LEADS_ENCRYPTION_KEY = 'a-completely-different-test-key-value';
    const other = require('../../../utility/pii-encryption');
    const foreign = other.encryptPii('secret-value');
    process.env.LEADS_ENCRYPTION_KEY = ORIGINAL;

    // The suite's own module (different key) must not be able to read it.
    expect(decryptPii(foreign)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E) Dual read (migration safety)
// ---------------------------------------------------------------------------

describe('E) Dual read across both schemes', () => {
  test('E1: readPii returns plaintext for v2: values', () => {
    expect(readPii(encryptPii('dual-read@example.com'))).toBe('dual-read@example.com');
  });

  test('E2: readPii sends non-v2 values down the legacy RSA path', () => {
    // Not a valid RSA blob, so the legacy path yields null — the point is that
    // it is *attempted*, i.e. pre-migration rows are not mistaken for AES.
    expect(readPii('bm90LWEtcmVhbC1yc2EtYmxvYg==')).toBeNull();
  });

  test('E3: readPii treats empty values as absent', () => {
    expect(readPii(null)).toBeNull();
    expect(readPii(undefined)).toBeNull();
    expect(readPii('')).toBeNull();
  });

  test('E4 (property): a v2 value is never routed to the legacy path', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (v) => {
        expect(readPii(encryptPii(v))).toBe(v);
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// F) Performance — the reason this change exists
// ---------------------------------------------------------------------------

describe('F) Performance characteristics', () => {
  test('F1: 3,000 field decrypts (a 1,000-lead export) complete in well under a second', () => {
    const blobs = Array.from({ length: 100 }, (_, i) => encryptPii(`lead${i}@example.com`));
    const t0 = Date.now();
    for (let i = 0; i < 3000; i++) decryptPii(blobs[i % blobs.length]);
    const elapsed = Date.now() - t0;

    // The RSA path this replaces took ~26 MINUTES for the same workload.
    expect(elapsed).toBeLessThan(1000);
  });

  test('F2: the scrypt key derivation is memoised, not repeated per field', () => {
    encryptPii('warm-up');                       // ensure derivation has happened
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) encryptPii('value');
    // 200 un-memoised scrypt derivations would take ~20s; memoised is milliseconds.
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
