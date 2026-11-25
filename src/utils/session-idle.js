'use strict';

/**
 * session-idle — VAPT #8: Session Inactivity Timeout
 *
 * Pure helper constants and functions shared between:
 *   • src/admin/app.js  — client-side idle tracker (browser, ESM)
 *   • p28 unit tests    — Jest (Node, CJS)
 *
 * All functions are pure (no side effects, no DOM access, no timers).
 * Browser-specific logic (addEventListener, setInterval, overlays) lives
 * exclusively in src/admin/app.js.
 *
 * Timing model:
 *   0 ────────────────────── 13 min ──────── 15 min
 *   │  normal activity zone  │  warn zone  │  auto-logout
 *
 * The 2-minute warning window gives legitimate users time to interact and
 * extend their session before the server-side timeout fires.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Time of inactivity after which the warning overlay appears. */
const IDLE_WARN_MS = 13 * 60 * 1000;       // 780 000 ms = 13 min

/** Time of inactivity after which the auto-logout fires. */
const IDLE_LOGOUT_MS = 15 * 60 * 1000;     // 900 000 ms = 15 min

/** Duration of the warning window (time between warning and logout). */
const IDLE_WARN_DURATION_MS = IDLE_LOGOUT_MS - IDLE_WARN_MS; // 120 000 ms = 2 min

/** How often the idle-state machine checks elapsed time. */
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;  // 30 000 ms = 30 s

/** Lightweight admin endpoint pinged when "Stay logged in" is clicked.
 *  Resets the server-side idle timer without performing a heavy operation. */
const IDLE_HEARTBEAT_PATH = '/admin/auth/me';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns milliseconds elapsed since `lastActivityAt`.
 * @param {number} lastActivityAt  — `Date.now()` at last recorded activity
 * @param {number} [now]           — override for testability; defaults to Date.now()
 * @returns {number}
 */
function getIdleMs(lastActivityAt, now) {
  return (now !== undefined ? now : Date.now()) - lastActivityAt;
}

/**
 * Returns milliseconds remaining before auto-logout (clamped to 0).
 * @param {number} lastActivityAt
 * @param {number} [now]
 * @returns {number}
 */
function getWarnCountdownMs(lastActivityAt, now) {
  return Math.max(0, IDLE_LOGOUT_MS - getIdleMs(lastActivityAt, now));
}

/**
 * Returns true when the idle time is in the warning zone:
 *   IDLE_WARN_MS ≤ idle < IDLE_LOGOUT_MS
 * @param {number} lastActivityAt
 * @param {number} [now]
 * @returns {boolean}
 */
function shouldWarn(lastActivityAt, now) {
  const idle = getIdleMs(lastActivityAt, now);
  return idle >= IDLE_WARN_MS && idle < IDLE_LOGOUT_MS;
}

/**
 * Returns true when idle time has reached or exceeded the logout threshold.
 * @param {number} lastActivityAt
 * @param {number} [now]
 * @returns {boolean}
 */
function shouldLogout(lastActivityAt, now) {
  return getIdleMs(lastActivityAt, now) >= IDLE_LOGOUT_MS;
}

/**
 * Formats a millisecond countdown value as "M:SS" (e.g. "1:30", "0:00").
 * Clamps to "0:00" — never returns negative time.
 * @param {number} remainingMs
 * @returns {string}
 */
function formatCountdown(remainingMs) {
  const totalSecs = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

module.exports = {
  IDLE_WARN_MS,
  IDLE_LOGOUT_MS,
  IDLE_WARN_DURATION_MS,
  IDLE_CHECK_INTERVAL_MS,
  IDLE_HEARTBEAT_PATH,
  getIdleMs,
  getWarnCountdownMs,
  shouldWarn,
  shouldLogout,
  formatCountdown,
};
