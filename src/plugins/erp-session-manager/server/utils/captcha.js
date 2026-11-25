'use strict';

/**
 * SVG Image CAPTCHA — challenge generation and answer verification.
 *
 * Uses `svg-captcha` (pure JS, no native binaries) to generate distorted SVG
 * text images. The expected answer is held server-side in CaptchaStore; the
 * client receives only an opaque, HMAC-signed `<nonce>:<expiry>` token.
 *
 * Each challenge is single-use: presenting the token spends it, correct answer
 * or not. See captcha-store.js for the full rationale — in short, the previous
 * stateless token both allowed unlimited replay and carried the expected answer
 * to the client in plain base64.
 *
 * VAPT #20 — Missing CAPTCHA (Low, CVSS 2.6).
 *
 * References: OWASP Testing Guide OTG-AUTHN-003
 */

const svgCaptcha                  = require('svg-captcha');
const { Resvg }                   = require('@resvg/resvg-js');
const { createHmac, timingSafeEqual, randomBytes, createHash } = require('node:crypto');
const captchaStore                = require('./captcha-store');

const SVG_OPTIONS = {
  size:        5,          // 5 characters per challenge
  ignoreChars: '0oO1lI',  // exclude visually ambiguous characters
  noise:       2,          // noise lines to hinder OCR (2 = readable but not trivial to OCR)
  color:       true,       // true = bright random colours — all pop clearly on dark background
  background:  '#1e1b4b',  // dark indigo — guarantees contrast for every random char colour
                           // (white bg fails: yellow characters become nearly invisible on white)
  width:       240,        // wider canvas = more letter spacing
  height:      80,
  fontSize:    54,         // larger font = easier to read without magnifying
};

/**
 * Convert an SVG string to a PNG data URI using @resvg/resvg-js (WASM/native).
 * Returns a `data:image/png;base64,...` string — safe to use as <img src> anywhere.
 * Falls back to a raw SVG data URI if conversion fails.
 *
 * @param {string} svg  Raw SVG markup
 * @returns {string}    PNG data URI
 */
function svgToPngDataUri(svg) {
  try {
    const resvg  = new Resvg(svg, { fitTo: { mode: 'original' } });
    const pngBuf = resvg.render().asPng();
    return 'data:image/png;base64,' + pngBuf.toString('base64');
  } catch (err) {
    // Fallback: return SVG as base64 data URI
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  }
}

/**
 * Parse and authenticate a challengeToken.
 * Verifies the HMAC and the expiry but does NOT spend the challenge.
 *
 * @param {string} secret
 * @param {string} challengeToken
 * @returns {{ nonce: string, expiry: number }|null}  null when absent, malformed,
 *   tampered with, or expired
 */
function _parseToken(secret, challengeToken) {
  const dotIdx = (challengeToken || '').lastIndexOf('.');
  if (dotIdx < 1) return null;

  const payloadB64 = challengeToken.slice(0, dotIdx);
  const sig        = challengeToken.slice(dotIdx + 1);
  if (!payloadB64 || !sig) return null;

  const payload  = Buffer.from(payloadB64, 'base64url').toString();
  const colonIdx = payload.lastIndexOf(':');
  if (colonIdx < 1) return null;

  const nonce  = payload.slice(0, colonIdx);
  const expiry = Number(payload.slice(colonIdx + 1));
  if (!nonce || !Number.isFinite(expiry)) return null;

  // Authenticate before trusting any field. Timing-safe to keep the signature
  // opaque to an attacker probing byte by byte.
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const expBuf   = Buffer.from(expected, 'hex');
  const sigBuf   = Buffer.from(sig,      'hex');
  if (expBuf.length !== sigBuf.length) return null;
  if (!timingSafeEqual(expBuf, sigBuf)) return null;

  if (Date.now() > expiry) return null;

  return { nonce, expiry };
}

/**
 * Generate an SVG image CAPTCHA challenge.
 *
 * The expected answer is retained in CaptchaStore and never serialised into the
 * token — the client gets an opaque signed nonce, so the image genuinely has to
 * be read.
 *
 * @param {string} secret   HMAC secret — use APP_KEYS[0]
 * @param {number} [ttlMs]  Token validity window in milliseconds (default 5 min)
 * @returns {{ captchaImage: string, challengeToken: string }}
 *   captchaImage   — PNG data URI; embed as a plain <img src>
 *   challengeToken — opaque single-use token; pass back with captchaAnswer
 */
function generateCaptchaChallenge(secret, ttlMs = 5 * 60 * 1000) {
  const { text, data: svgMarkup } = svgCaptcha.create(SVG_OPTIONS);
  const answer = text.toLowerCase(); // normalise — comparison is case-insensitive
  const expiry = Date.now() + ttlMs;
  const nonce  = randomBytes(16).toString('hex');

  captchaStore.put(nonce, answer, expiry);

  const payload = `${nonce}:${expiry}`;
  const sig     = createHmac('sha256', secret).update(payload).digest('hex');

  return {
    // PNG data URI — renders as a plain <img src> with no SVG/browser quirks
    captchaImage: svgToPngDataUri(svgMarkup),
    challengeToken: `${Buffer.from(payload).toString('base64url')}.${sig}`,
  };
}

/**
 * Verify a submitted CAPTCHA answer and spend the challenge.
 * Case-insensitive. Never throws.
 *
 * The challenge is consumed before the answer is compared, so a wrong guess
 * burns it too. A caller that fails verification must fetch a new challenge —
 * resubmitting the same token always returns false.
 *
 * @param {string} secret
 * @param {string} challengeToken  Token from generateCaptchaChallenge
 * @param {string} providedAnswer  User-typed text
 * @returns {boolean}  true = pass; false = wrong answer, already used, expired,
 *   tampered, or missing
 */
function verifyCaptchaAnswer(secret, challengeToken, providedAnswer) {
  try {
    const parsed = _parseToken(secret, challengeToken);
    if (!parsed) return false;

    // Single-use gate — deletes the entry, so this token can never pass again.
    const entry = captchaStore.consume(parsed.nonce);
    if (!entry) return false;

    const provided = (providedAnswer || '').trim().toLowerCase();

    // Compare digests so timingSafeEqual gets equal-length buffers regardless
    // of how long a string the client sent.
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(entry.answer).digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Look up the expected answer for a token without spending it.
 * Test/introspection helper only — nothing on a request path may call this.
 *
 * @param {string} secret
 * @param {string} challengeToken
 * @returns {string|null}
 */
function _getChallengeAnswer(secret, challengeToken) {
  const parsed = _parseToken(secret, challengeToken);
  if (!parsed) return null;
  const entry = captchaStore.peek(parsed.nonce);
  return entry ? entry.answer : null;
}

module.exports = { generateCaptchaChallenge, verifyCaptchaAnswer, _getChallengeAnswer };
