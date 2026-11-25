'use strict';

/**
 * SessionActivityLogger_Middleware — logs per-request HTTP activity for authenticated sessions.
 *
 * Runs AFTER next() so statusCode is known. Skips unauthenticated requests.
 * Only inserts when policy.activityLoggingEnabled is true.
 * Debounced 5 s per ${sessionId}:${method}:${url} to avoid duplicate rows for
 * repeated rapid requests on the same endpoint.
 *
 * References: Gap G2 (activity log), Gap G7 (activity logger middleware)
 */

const debounceMap = new Map(); // key → expiresAt timestamp

// Methods whose body is recorded. DELETE is included because the bulk-delete
// endpoints carry their payload in the body ({ ids: [...] }); GET is the only
// verb left out, since it has none.
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Hard cap on the stored JSON. The column is TEXT (64 KB); a dynamic-zone save
// or a big import can be far larger than anything useful to read back.
const MAX_BODY_CHARS = 8000;

// Secrets are encrypted and PII is partially masked before storage — see
// utils/activity-body.js. transformBody() returns a COPY; ctx.request.body is
// never touched, so the request the handler sees is exactly what was sent.
const { transformBody, shouldMaskPii } = require('../utils/activity-body');

/**
 * Serialise the request body for storage, or null when there is nothing to
 * store. Binary uploads are never recorded — multipart bodies carry file parts,
 * and the point here is the JSON payload, not the bytes of an upload.
 *
 * @param {object} ctx — Koa context
 * @returns {string|null}
 */
function captureRequestBody(ctx) {
  const method = (ctx.method || '').toUpperCase();
  if (!BODY_METHODS.has(method)) return null;

  // Uploads: koa-body puts file parts on ctx.request.files and leaves the
  // binary out of ctx.request.body, but skip the whole request regardless so a
  // multipart form's text fields do not smuggle a file's metadata in either.
  const contentType = ctx.request.type || '';
  if (/multipart/i.test(contentType)) return null;
  if (ctx.request.files && Object.keys(ctx.request.files).length > 0) return null;

  const body = ctx.request.body;
  if (body === null || body === undefined) return null;
  if (Buffer.isBuffer(body)) return null;                    // raw binary
  if (typeof body !== 'object') return null;                 // string/stream bodies
  if (Object.keys(body).length === 0) return null;           // nothing to record

  let text;
  try {
    text = JSON.stringify(transformBody(body, { maskPii: shouldMaskPii(ctx.path) }));
  } catch {
    return null;   // not serialisable — never worth failing the log over
  }
  if (!text || text === '{}') return null;

  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}…[TRUNCATED]`
    : text;
}

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await next();

    // Only log authenticated requests
    if (!ctx.state || !ctx.state.user) return;

    const userId = ctx.state.user.id;
    if (!userId) return;

    // Snapshot the body NOW, synchronously, before handing off to setImmediate.
    // ctx.request.body is shared state; capturing later would race anything
    // downstream that reassigns it. This reads the body and returns a new
    // string — it does not modify the request.
    const requestBody = captureRequestBody(ctx);

    // Check policy — fire-and-forget, don't block response
    setImmediate(async () => {
      try {
        const policyService = strapi.plugin('erp-session-manager').service('policy');
        const policy = await policyService.getPolicy();

        if (!policy.activityLoggingEnabled) return;

        // Resolve sessionId from active session
        const storeModule = require('../services/store');
        const store = storeModule.getStore();
        const userSessions = await store.getByUser(userId);
        const now = Date.now();
        const activeSession = userSessions.find((s) => !s.isRevoked && s.expiresAt > now);

        if (!activeSession) return;

        const sessionId = activeSession.sessionId;
        const method    = (ctx.method || '').toUpperCase();
        const url       = (ctx.path || '').slice(0, 2048);

        // Debounce: skip if same key was logged within the last 5 seconds.
        // Only for body-less requests — the debounce exists to stop repeated
        // polling GETs piling up. Two writes to the same endpoint inside 5 s
        // are distinct events with distinct payloads, and collapsing them
        // would silently drop one of the bodies we are here to record.
        if (!requestBody) {
          const debounceKey = `${sessionId}:${method}:${url}`;
          const lastLog = debounceMap.get(debounceKey);
          if (lastLog && now - lastLog < 5000) return;
          debounceMap.set(debounceKey, now);
        }

        // Clean up old debounce entries periodically (every ~100 entries)
        if (debounceMap.size > 100) {
          for (const [k, ts] of debounceMap.entries()) {
            if (now - ts > 10000) debounceMap.delete(k);
          }
        }

        await strapi.documents('plugin::erp-session-manager.erp-session-activity').create({
          data: {
            sessionId,
            userId,
            method,
            url,
            statusCode: ctx.status || 0,
            loggedAt:   new Date().toISOString(),
            requestBody,
          },
        });
      } catch (err) {
        strapi.log.warn(`[erp-session-manager] Activity log error: ${err.message}`);
      }
    });
  };
};
