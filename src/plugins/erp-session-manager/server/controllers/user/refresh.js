'use strict';

/**
 * User Refresh Controller
 *
 * Endpoint (Design §6.3):
 *   POST /api/erp-session/refresh
 *
 * Accepts refresh token via:
 *   - HttpOnly cookie: erp_rt (preferred for browser clients)
 *   - Request body:    { refreshToken: "..." } (for non-browser clients)
 *
 * On success: issues new JWT, rotates refresh token, sets new erp_rt cookie.
 * On failure: HTTP 401.
 *
 * References: Req 2.3–2.8, Req 13.5, Req 16.11, Design §6.3
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');
const { buildCookieOptions } = require('../../utils/cookie-options');

module.exports = ({ strapi }) => ({
  async refresh(ctx) {
    setRequestId(ctx);

    const pluginConfig = strapi.config.get('plugin::erp-session-manager');
    const cookieName = (pluginConfig && pluginConfig.cookies && pluginConfig.cookies.name)
      ? pluginConfig.cookies.name
      : 'erp_rt';

    // Accept token from cookie (preferred) or request body.
    // VAPT #15: only accept body token if it is a non-empty string — non-string values
    // (array, number, null, object) are silently ignored to prevent type-coercion bypass.
    const bodyToken = ctx.request.body?.refreshToken;
    const rawToken  = ctx.cookies.get(cookieName) ||
      (typeof bodyToken === 'string' && bodyToken.length > 0 ? bodyToken : null);

    if (!rawToken) {
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Refresh token is required.', { reason: 'MISSING_TOKEN' });
      return;
    }

    const sessionService  = strapi.plugin('erp-session-manager').service('session');
    const keyRotator      = strapi.plugin('erp-session-manager').service('keyRotator');
    const auditLogger     = strapi.plugin('erp-session-manager').service('auditLogger');

    const ip        = ctx.ip || ctx.request.ip || 'unknown';
    const userAgent = ctx.get('User-Agent') || '';

    // Validate the refresh token
    const sessionRecord = await sessionService.validateRefreshToken(rawToken);

    if (!sessionRecord) {
      auditLogger.log({
        eventType: 'TOKEN_REUSE_ATTEMPT',
        ipAddress: ip,
        userAgent,
        outcome: 'FAILURE',
      });
      ctx.status = 401;
      ctx.body = envelopeError(401, 'UnauthorizedError', 'Invalid or expired refresh token.', { reason: 'INVALID_TOKEN' });
      return;
    }

    // Sign a new access token.
    //
    // keyIndex is a constant, not a lookup: keyRotator.sign() always signs with
    // signingKeys[0] and stamps `kid: '0'`, so the index recorded on the
    // TOKEN_REFRESH audit event below is always 0. This replaced a vestigial
    // IIFE whose try block returned an object literal and therefore could never
    // reach its catch (S1763). Note there is no JWT to verify on this endpoint —
    // the incoming credential is an opaque CSPRNG refresh token matched by
    // SHA-256 hash — so keyRotator.verify()'s real key index never applies here.
    const keyIndex = 0;

    const newJwt = keyRotator.sign({
      id:    sessionRecord.userId,
      iat:   Math.floor(Date.now() / 1000),
    });

    // Rotate the refresh token
    const newRawToken = await sessionService.rotateRefreshToken(sessionRecord.sessionId);

    // Set new erp_rt cookie
    const refreshTokenTtl = (pluginConfig && pluginConfig.tokens && pluginConfig.tokens.refreshTokenTtl)
      ? pluginConfig.tokens.refreshTokenTtl
      : 28800;

    ctx.cookies.set(cookieName, newRawToken, buildCookieOptions(pluginConfig, refreshTokenTtl * 1000));

    // Log TOKEN_REFRESH audit event
    auditLogger.log({
      eventType: 'TOKEN_REFRESH',
      userId:    sessionRecord.userId,
      sessionId: sessionRecord.sessionId,
      ipAddress: ip,
      userAgent,
      outcome:   'SUCCESS',
      metadata:  { keyIndex },
    });

    const accessTokenTtl = (pluginConfig && pluginConfig.tokens && pluginConfig.tokens.accessTokenTtl)
      ? pluginConfig.tokens.accessTokenTtl
      : 900;

    ctx.body = envelope({
      jwt:       newJwt,
      expiresAt: new Date(Date.now() + accessTokenTtl * 1000).toISOString(),
    });
  },
});
