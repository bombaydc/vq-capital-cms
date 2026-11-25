'use strict';

/**
 * sanitize-ua.js
 *
 * Helpers for cleaning attacker-controlled HTTP header values before storage.
 * Used by AuditLogger and SessionService to prevent stored XSS via
 * User-Agent and IP address fields.
 *
 * References: VAPT Finding #2 (HTML Injection), Gap 3
 */

const sanitizeHtml = require('sanitize-html');

// Maximum length for stored User-Agent strings
const MAX_UA_LENGTH = 512;

// Allow-list regex for IP addresses:
//   - IPv4: four dot-separated octets (each 1–3 digits)
//   - IPv6: colon-separated hex groups (2–45 chars)
//   - Sentinel string 'unknown'
const IP_ALLOWLIST_RE = /^(unknown|(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{2,45})$/;

/**
 * sanitizeUserAgent(rawUa)
 *
 * Cleans an attacker-controlled User-Agent string before storage:
 *   1. Coerces to string and truncates to MAX_UA_LENGTH characters.
 *   2. Strips null bytes and ASCII control characters (U+0000–U+001F, U+007F).
 *   3. Strips all HTML tags using sanitize-html with allowedTags: [].
 *
 * Returns an empty string for null/undefined input.
 *
 * @param {unknown} rawUa
 * @returns {string}
 */
function sanitizeUserAgent(rawUa) {
  if (rawUa === null || rawUa === undefined) return '';

  // 1. Coerce and truncate
  let ua = String(rawUa).slice(0, MAX_UA_LENGTH);

  // 2. Strip null bytes and ASCII control characters
  // eslint-disable-next-line no-control-regex
  ua = ua.replace(/[\x00-\x1F\x7F]/g, '');

  // 3. Strip all HTML tags
  ua = sanitizeHtml(ua, { allowedTags: [], allowedAttributes: {} });

  return ua;
}

/**
 * sanitizeIpAddress(rawIp)
 *
 * Validates that the IP address string looks like a valid IPv4 or IPv6
 * address, or the sentinel string 'unknown'. Replaces anything else
 * (including HTML/script injection) with 'unknown'.
 *
 * @param {unknown} rawIp
 * @returns {string}
 */
function sanitizeIpAddress(rawIp) {
  if (rawIp === null || rawIp === undefined) return 'unknown';

  const ip = String(rawIp).trim().slice(0, 45);
  return IP_ALLOWLIST_RE.test(ip) ? ip : 'unknown';
}

module.exports = { sanitizeUserAgent, sanitizeIpAddress };
