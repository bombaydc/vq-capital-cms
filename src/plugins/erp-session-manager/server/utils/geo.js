'use strict';

/**
 * GeoUtils — MaxMind GeoLite2 wrapper for IP geolocation.
 *
 * Used by AnomalyDetector for impossible-travel checks (Req 5.6).
 * When the GeoLite2 database is unavailable, all lookups return null and
 * the impossible-travel check is silently skipped (Req 5.7).
 */

const maxmind = require('maxmind');

/** @type {import('maxmind').Reader | null} */
let reader = null;

module.exports = {
  /**
   * init(dbPath)
   * Loads the GeoLite2-City database from the given file path.
   * Called from bootstrap(). Failures are logged as warnings and do not halt startup.
   * @param {string} dbPath — absolute path to GeoLite2-City.mmdb
   * @returns {Promise<void>}
   */
  async init(dbPath) {
    try {
      reader = await maxmind.open(dbPath);
    } catch (err) {
      reader = null;
      console.warn(
        `[erp-session-manager] GeoLite2 database could not be loaded from "${dbPath}": ${err.message}. ` +
        'Impossible-travel checks will be disabled (Req 5.7).'
      );
    }
  },

  /**
   * lookup(ipAddress)
   * Resolves geolocation data for an IP address.
   * @param {string} ipAddress
   * @returns {{ city: string|null, country: string|null, lat: number|null, lon: number|null } | null}
   */
  lookup(ipAddress) {
    if (!reader) return null;
    try {
      const data = reader.get(ipAddress);
      if (!data) return null;
      return {
        city:    data.city?.names?.en    ?? null,
        country: data.country?.iso_code  ?? null,
        lat:     data.location?.latitude  ?? null,
        lon:     data.location?.longitude ?? null,
      };
    } catch {
      return null;
    }
  },

  /**
   * isAvailable()
   * @returns {boolean} true when the GeoLite2 database is loaded
   */
  isAvailable() {
    return reader !== null;
  },

  /** Test helper: clears the reader so tests can reinitialise. */
  _reset() {
    reader = null;
  },

  /**
   * Test helper: inject a reader stub directly (avoids needing a real .mmdb file).
   * Only call this from unit tests — never in production code.
   * @param {{ get: function }} stubReader
   */
  __testSetReader(stubReader) {
    reader = stubReader;
  },
};
