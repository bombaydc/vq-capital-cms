'use strict';

/**
 * CaptchaStore — server-side, single-use registry of outstanding CAPTCHA challenges.
 *
 * Why this exists (VAPT — CAPTCHA replay / bypass):
 *   The original challengeToken was fully stateless: it carried
 *   `base64url("<answer>:<expiry>")` plus an HMAC. That had two defects:
 *
 *     1. REPLAY — nothing marked a challenge as spent, so one solved
 *        token could be resubmitted on every request until it expired
 *        (default 5 min), defeating the anti-automation purpose entirely.
 *     2. DISCLOSURE — base64url is encoding, not encryption. The expected
 *        answer was handed to the client in the clear, so the image never
 *        had to be solved at all.
 *
 *   Both are fixed by keeping the answer on the server and handing the client
 *   nothing but an opaque, signed nonce. The nonce is deleted the first time it
 *   is presented — whether or not the submitted answer was correct — so each
 *   challenge grants exactly one attempt.
 *
 * Scope / limitations (deliberate, documented):
 *   Storage is in-process, matching the existing in-memory pattern used by
 *   RateLimiter, TokenRevocation and AdminLoginTotp. Challenges are short-lived
 *   (default 300 s), so a restart or a second node simply means the user solves
 *   a fresh image. Do NOT promote this to a shared backend without also moving
 *   those services, or the security model becomes inconsistent.
 *
 * References: OWASP Testing Guide OTG-AUTHN-003 (weak CAPTCHA implementation)
 */

/** @type {Map<string, { answer: string, expiresAt: number }>} */
const _challenges = new Map();

// Upper bound on outstanding challenges. An unauthenticated endpoint mints
// these, so the map must not be allowed to grow without limit. Reaching the cap
// evicts the oldest entries (Map preserves insertion order).
const MAX_ENTRIES = 20000;

// Background sweep for entries that expired without ever being submitted.
const PURGE_INTERVAL_MS = 60 * 1000;

/**
 * Drop every entry whose expiry has passed.
 * @returns {number} number of entries removed
 */
function purgeExpired() {
  const now = Date.now();
  let removed = 0;
  for (const [nonce, entry] of _challenges) {
    if (entry.expiresAt <= now) {
      _challenges.delete(nonce);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Register a freshly generated challenge.
 *
 * @param {string} nonce      128-bit CSPRNG hex identifier
 * @param {string} answer     expected answer, already lower-cased
 * @param {number} expiresAt  absolute ms timestamp
 */
function put(nonce, answer, expiresAt) {
  if (_challenges.size >= MAX_ENTRIES) {
    purgeExpired();
    // Still full — evict oldest insertions until there is headroom.
    while (_challenges.size >= MAX_ENTRIES) {
      const oldest = _challenges.keys().next();
      if (oldest.done) break;
      _challenges.delete(oldest.value);
    }
  }
  _challenges.set(nonce, { answer, expiresAt });
}

/**
 * Retrieve and immediately delete a challenge — the single-use gate.
 *
 * Deleting on read (rather than after a successful comparison) is what stops
 * both replay of a solved challenge and brute-forcing the answer against a
 * single challenge: one nonce buys exactly one guess.
 *
 * @param {string} nonce
 * @returns {{ answer: string, expiresAt: number }|null}
 *   null when the nonce is unknown, already spent, or expired
 */
function consume(nonce) {
  if (!nonce) return null;
  const entry = _challenges.get(nonce);
  if (!entry) return null;

  _challenges.delete(nonce);

  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

/**
 * Read a challenge without spending it.
 * Test/introspection only — never call this on a request path.
 *
 * @param {string} nonce
 * @returns {{ answer: string, expiresAt: number }|null}
 */
function peek(nonce) {
  return _challenges.get(nonce) || null;
}

/** Current number of outstanding challenges (diagnostics + tests). */
function size() {
  return _challenges.size;
}

/** Remove every entry. Test helper. */
function clear() {
  _challenges.clear();
}

// unref() so an idle sweep timer never holds the process (or a Jest run) open.
const _timer = setInterval(purgeExpired, PURGE_INTERVAL_MS);
if (typeof _timer.unref === 'function') _timer.unref();

module.exports = { put, consume, peek, purgeExpired, size, clear, MAX_ENTRIES };
