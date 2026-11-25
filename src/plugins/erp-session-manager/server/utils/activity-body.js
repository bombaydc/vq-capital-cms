'use strict';

/**
 * ActivityBody — prepares a request body for storage in the activity log.
 *
 * THIS NEVER MUTATES THE REQUEST. Every function here builds a new value and
 * leaves the input untouched; `ctx.request.body` must reach the route handler
 * exactly as the client sent it, or logging would corrupt the very request it
 * is recording (an encrypted password would be stored AND submitted).
 * Guarded by p55 §A.
 *
 * Three treatments, applied by key name:
 *
 *   secrets → AES-256-GCM, stored as `enc:v1:<base64>`
 *       Passwords, tokens, TOTP codes and CAPTCHA answers. Encrypted rather
 *       than dropped so the record is complete, and never readable from the
 *       Activity Log UI.
 *   PII → partially masked, e.g. `ra••••••••@g••••.com`, `••••••3210`
 *       Enough to identify which record a row refers to, not enough to read
 *       the address or number back.
 *   everything else → stored as-is
 *
 * References: activity log (Gap G2), lead PII pattern in src/utility/pii-encryption.js
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Key classification
// ---------------------------------------------------------------------------

/**
 * Values that are encrypted. Matched anywhere in the key name, so `password`,
 * `currentPassword` and `user_api_key` all qualify.
 *
 * Separators are stripped from the key before matching rather than spelled as
 * `[-_]?` inside the pattern — that keeps `api_key`, `api-key` and `apiKey`
 * equivalent without three optional groups inflating the regex.
 */
const SECRET_KEY = /pass|secret|token|jwt|otp|captcha|credential|apikey|authorization|cookie|cvv|cardnumber|privatekey/i;

/**
 * Does this key name hold a secret?
 *
 * @param {string} key
 * @returns {boolean}
 */
function isSecretKey(key) {
  return SECRET_KEY.test(String(key).replaceAll(/[-_]/g, ''));
}

/**
 * Values that are masked. `name` is PII in this system, but a CMS body is full
 * of structural *_name keys that are not — those are excluded explicitly so a
 * content-type save stays readable.
 */
const PII_NAME_EXCLUDE = /(file|field|collection|singular|plural|display|model|plugin|role|type|schema|component|attribute|table|column|host|user)_?name/i;
const PII_EMAIL  = /e-?mail/i;
const PII_PHONE  = /phone|mobile|whatsapp|telephone|msisdn/i;
const PII_OTHER  = /address|pincode|postal|zip|dob|birth|aadha?ar|passport|\bpan\b|gstin?|ssn|nationalid/i;

function isPiiKey(key) {
  if (PII_EMAIL.test(key) || PII_PHONE.test(key) || PII_OTHER.test(key)) return true;
  if (/name/i.test(key) && !PII_NAME_EXCLUDE.test(key)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Encryption — same scheme as the step-up secret store
// ---------------------------------------------------------------------------

// Memoised: scrypt costs ~100 ms, and a body can hold several secret fields.
let _cachedKey = null;

function deriveKey() {
  if (_cachedKey) return _cachedKey;
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) throw new Error('ENCRYPTION_KEY is not set');
  _cachedKey = crypto.scryptSync(encKey, 'erp:activity-body-v1', 32);
  return _cachedKey;
}

/**
 * AES-256-GCM with a fresh random IV per call — a fixed IV would leak equality
 * between two identical passwords.
 *
 * @param {*} value
 * @returns {string} `enc:v1:<base64(iv[12] || tag[16] || ciphertext)>`
 */
function encryptValue(value) {
  const key    = deriveKey();
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct     = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

/** Reverse of encryptValue(); for operators who need the original value. */
function decryptValue(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc:v1:')) return null;
  const raw = Buffer.from(stored.slice(7), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

const DOT = '•';

/** Cap the run of dots so a long value cannot bloat the stored row. */
function dots(n) {
  return DOT.repeat(Math.min(Math.max(n, 1), 8));
}

function maskHead(str, keep) {
  if (str.length <= keep) return dots(3);
  return str.slice(0, keep) + dots(str.length - keep);
}

function maskTail(str, keep) {
  if (str.length <= keep) return dots(3);
  return dots(str.length - keep) + str.slice(-keep);
}

function maskEmail(str) {
  const at = str.lastIndexOf('@');
  if (at < 1) return maskHead(str, 2);

  const local  = str.slice(0, at);
  const domain = str.slice(at + 1);
  const dot    = domain.lastIndexOf('.');

  const maskedDomain = dot < 1
    ? maskHead(domain, 1)
    : `${maskHead(domain.slice(0, dot), 1)}${domain.slice(dot)}`;   // keep the TLD

  return `${maskHead(local, 2)}@${maskedDomain}`;
}

/**
 * Mask a PII value so the row is still identifiable.
 * Non-strings are replaced wholesale — there is no partial form of a number
 * that is both useful and safe to guess at.
 */
function maskPii(key, value) {
  if (typeof value !== 'string') return typeof value === 'number' ? maskTail(String(value), 2) : dots(3);
  if (!value) return value;

  if (PII_EMAIL.test(key) || value.includes('@')) return maskEmail(value);
  if (PII_PHONE.test(key)) return maskTail(value, 4);
  return maskHead(value, 2);
}

// ---------------------------------------------------------------------------
// Body transformation
// ---------------------------------------------------------------------------

const MAX_DEPTH = 12;
const MAX_ARRAY = 200;

/**
 * Paths whose bodies are stored verbatim, without PII masking.
 *
 * Content Manager payloads are CMS content, not identity data, and the PII key
 * rules would wreck them — every `name`, every `title`, every author field and
 * address block in an entry would come back as dots, leaving a log nobody can
 * read.
 *
 * Secret encryption still applies here. It costs nothing on a content payload
 * (no content type has a password field), and it means this exemption can never
 * become the one path a credential leaks through.
 *
 * /content-type-builder/ is exempt for the same reason: its payloads are schema
 * definitions — attribute names, component names, relation targets — which are
 * structure, not identity. PII_NAME_EXCLUDE already spares the compound keys
 * (collectionName, displayName, singularName…), but a bare `name` on an
 * attribute was still being masked, which made update-schema rows unreadable.
 *
 * MATCH THE API PATH, NOT THE BROWSER URL. The admin SPA lives at
 * /admin/content-manager/…, but the request Koa sees is /content-manager/… —
 * Strapi mounts plugin admin routes under the plugin name, with no /admin
 * prefix. The first version of this list matched the browser URL and therefore
 * never fired, so content entries came back masked
 * (`{"name":"Ab••••••••"}`). Confirmed against the logged rows: every real
 * entry is /content-manager/single-types/…, /content-manager/collection-types/…
 * or /content-type-builder/update-schema.
 */
const PII_EXEMPT_PATHS = [
  /^\/content-manager\//,
  /^\/content-type-builder\//,
];

/**
 * Should PII in a body at this path be masked?
 *
 * @param {string} path — ctx.path, no query string
 * @returns {boolean}
 */
function shouldMaskPii(path) {
  const clean = String(path || '').split('?')[0];
  return !PII_EXEMPT_PATHS.some((re) => re.test(clean));
}

/**
 * Build a storable COPY of a parsed body. The input is never modified.
 *
 * Depth-limited and cycle-safe: bodies are attacker-influenced, so a deeply
 * nested or self-referential payload must not blow the stack inside a logger.
 *
 * @param {*} value
 * @param {{ maskPii?: boolean }} [opts] — maskPii defaults to true
 * @param {number} depth
 * @param {WeakSet} seen
 * @returns {*} a new value — never the input
 */
function transformBody(value, opts = {}, depth = 0, seen = new WeakSet()) {
  const doMask = opts.maskPii !== false;

  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `[BUFFER:${value.length}]`;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => transformBody(v, opts, depth + 1, seen));
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = (val === null || val === undefined)
      ? val
      : transformEntry(key, val, opts, doMask, depth, seen);
  }
  return out;
}

/**
 * Decide the treatment for a single key/value pair: encrypt, mask, or recurse.
 *
 * @param {string} key
 * @param {*} val
 * @param {object} opts
 * @param {boolean} doMask
 * @param {number} depth
 * @param {WeakSet} seen
 * @returns {*}
 */
function transformEntry(key, val, opts, doMask, depth, seen) {
  if (isSecretKey(key)) {
    try {
      return encryptValue(val);
    } catch {
      // No ENCRYPTION_KEY, or a value that will not stringify — the one thing
      // that must never happen is storing the secret in the clear.
      return '[ENCRYPT_FAILED]';
    }
  }
  if (doMask && isPiiKey(key)) return maskPii(key, val);
  return transformBody(val, opts, depth + 1, seen);
}

module.exports = {
  transformBody,
  shouldMaskPii,
  encryptValue,
  decryptValue,
  maskPii,
  maskEmail,
  isPiiKey,
  isSecretKey,
  SECRET_KEY,
  _resetKeyCache() { _cachedKey = null; },   // tests only
};
