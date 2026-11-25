'use strict';

/**
 * Admin Status Controller
 *
 * Endpoint (Design §6.2):
 *   GET /erp-session-manager/status — plugin health and store status (Req 16.8)
 *
 * References: Req 16.8, Design §6.2
 */

const { envelope, setRequestId } = require('../../utils/response');
const storeModule = require('../../services/store');

module.exports = ({ strapi: _strapi }) => ({
  async getStatus(ctx) {
    setRequestId(ctx);

    const store = storeModule.getStore();
    const now = Date.now();

    // Determine backend type by inspecting the proxy-forwarded properties
    let storeBackend = 'memory';
    let redisStatus  = 'disabled';

    try {
      if (store._backendType === 'hybrid') {
        // HybridStore — memory reads + MariaDB write-through
        storeBackend = 'hybrid';
      } else if (store._backendType === 'database') {
        // DatabaseStore — pure DB persistence
        storeBackend = 'database';
      } else if (store._client !== undefined && store._client) {
        // RedisStore — identified by the ioredis _client property
        storeBackend = 'redis';
        redisStatus  = 'connected';
      }
    } catch {
      // stay with defaults
    }

    // Count active and anomaly sessions
    let activeSessions  = 0;
    let anomalySessions = 0;

    try {
      const { records: active }  = await store.listAll({ status: 'active',  pageSize: 10000 });
      const { records: anomaly } = await store.listAll({ status: 'anomaly', pageSize: 10000 });
      activeSessions  = active.length;
      anomalySessions = anomaly.filter((r) => !r.isRevoked && r.expiresAt > now).length;
    } catch {
      // best-effort
    }

    ctx.body = envelope({
      storeBackend,
      redisStatus,
      activeSessions,
      anomalySessions,
      uptime: Math.floor(process.uptime()),
    });
  },
});
