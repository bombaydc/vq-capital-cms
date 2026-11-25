'use strict';

/**
 * AnomalyDetector — evaluates mid-session anomalies.
 *
 * Checks performed in order (Design §5.3):
 *   1. IP change   — sessionRecord.ipAddress vs requestContext.ipAddress
 *   2. UA change   — sessionRecord.userAgent vs requestContext.userAgent
 *   3. Impossible travel — haversine distance / elapsed hours > maxSpeedKmh
 *
 * Returns { anomalies: string[], shouldBlock: boolean }
 *
 * References: Req 5.1–5.7, Design §5.3
 */

const geo = require('../utils/geo');

module.exports = ({ strapi }) => ({
  /**
   * check(sessionRecord, requestContext)
   * @param {object} sessionRecord — stored Session_Record
   * @param {object} requestContext — { ipAddress, userAgent, timestamp }
   * @returns {Promise<{ anomalies: string[], shouldBlock: boolean }>}
   */
  async check(sessionRecord, requestContext) {
    const anomalies = [];
    let shouldBlock = false;

    const anomalyConfig = await this.resolveAnomalyConfig();

    // 1. IP change check (Req 5.1, Req 5.3)
    if (sessionRecord.ipAddress !== requestContext.ipAddress && anomalyConfig.blockOnIpChange) {
      anomalies.push('IP_CHANGE');
      shouldBlock = true;
    }

    // 2. UA change check (Req 5.2, Req 5.4)
    if (sessionRecord.userAgent !== requestContext.userAgent && anomalyConfig.blockOnUaChange) {
      anomalies.push('UA_CHANGE');
      shouldBlock = true;
    }

    // 3. Impossible travel check (Req 5.5, Req 5.6, Req 5.7)
    if (this.isImpossibleTravel(sessionRecord, requestContext, anomalyConfig)) {
      anomalies.push('IMPOSSIBLE_TRAVEL');
      shouldBlock = true;
    }

    return { anomalies, shouldBlock };
  },

  /**
   * resolveAnomalyConfig()
   *
   * Reads anomaly settings from the live policy (DB-backed, 5-min cache) and
   * falls back to static plugin config if the policy service is unavailable.
   *
   * @returns {Promise<{blockOnIpChange: boolean, blockOnUaChange: boolean, impossibleTravelEnabled: boolean, maxSpeedKmh: number}>}
   */
  async resolveAnomalyConfig() {
    try {
      const policyService = strapi.plugin('erp-session-manager').service('policy');
      const policy = await policyService.getPolicy();
      return {
        blockOnIpChange:         policy.blockOnIpChange,
        blockOnUaChange:         policy.blockOnUaChange,
        impossibleTravelEnabled: policy.impossibleTravelEnabled,
        maxSpeedKmh:             policy.maxSpeedKmh,
      };
    } catch (err) {
      strapi.log.warn(`[anomaly-detector] policy read failed, using static config: ${err.message}`);
      const pluginConfig = strapi.config.get('plugin::erp-session-manager');
      const an = (pluginConfig?.sessions?.anomaly) || {};
      return {
        blockOnIpChange:         an.blockOnIpChange         ?? true,
        blockOnUaChange:         an.blockOnUaChange         ?? false,
        impossibleTravelEnabled: an.impossibleTravelEnabled ?? false,
        maxSpeedKmh:             an.maxSpeedKmh             ?? 900,
      };
    }
  },

  /**
   * isImpossibleTravel(sessionRecord, requestContext, anomalyConfig)
   *
   * Fails open (returns false) on every non-decision path — disabled by policy,
   * GeoLite2 unavailable (Req 5.7), either endpoint's coordinates missing, or a
   * lookup error — so a geo problem can never by itself terminate a session.
   *
   * @returns {boolean} true only when travel speed provably exceeds maxSpeedKmh
   */
  isImpossibleTravel(sessionRecord, requestContext, anomalyConfig) {
    if (!anomalyConfig.impossibleTravelEnabled) return false;

    if (!geo.isAvailable()) {
      strapi.log.warn(
        '[erp-session-manager] Impossible travel check skipped: GeoLite2 database unavailable (Req 5.7)'
      );
      return false;
    }

    try {
      const currentGeo  = this.resolveGeo(requestContext.ipAddress);
      const previousGeo = sessionRecord.geoLocation;

      if (
        currentGeo?.lat == null || currentGeo?.lon == null ||
        previousGeo?.lat == null || previousGeo?.lon == null
      ) {
        return false;
      }

      const distanceKm = this.haversineDistance(
        previousGeo.lat, previousGeo.lon,
        currentGeo.lat, currentGeo.lon
      );
      const elapsedHours = (requestContext.timestamp - sessionRecord.lastActive) / 3600000;

      return elapsedHours > 0 && distanceKm / elapsedHours > anomalyConfig.maxSpeedKmh;
    } catch (err) {
      strapi.log.warn(
        `[erp-session-manager] Impossible travel check failed for session ${sessionRecord.sessionId}: ${err.message}`
      );
      return false;
    }
  },

  /**
   * resolveGeo(ipAddress)
   * @param {string} ipAddress
   * @returns {{ city: string|null, country: string|null, lat: number|null, lon: number|null } | null}
   */
  resolveGeo(ipAddress) {
    return geo.lookup(ipAddress);
  },

  /**
   * haversineDistance(lat1, lon1, lat2, lon2)
   * Computes great-circle distance between two points on Earth.
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} distance in km
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
});
