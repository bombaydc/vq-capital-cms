'use strict';

/**
 * Header Hardener Middleware — VAPT #14 (Banner Grabbing)
 *
 * Runs exclusively in the after-next() phase so it executes AFTER every
 * downstream middleware has finished setting response headers. Removes headers
 * that disclose server product, version, or technology-stack information to
 * potential attackers (e.g., Server: nginx/1.27, X-Powered-By: Strapi).
 *
 * Headers removed:
 *   Server               — web server / runtime identifier (nginx, node, Apache…)
 *   X-Powered-By         — framework identifier (Strapi, Express, PHP…)
 *   Via                  — proxy-chain disclosure (reveals internal infrastructure)
 *   X-Generator          — CMS / static-site-generator branding
 *   X-AspNet-Version     — IIS / ASP.NET version string (belt-and-suspenders)
 *   X-AspNetMvc-Version  — ASP.NET MVC version string (belt-and-suspenders)
 *
 * Placement (critical):
 *   This middleware MUST be the OUTERMOST entry in config/middlewares.js.
 *   In Koa's onion model the outermost middleware's after-next() code runs
 *   absolutely last — after every other middleware has returned. This guarantees
 *   the sweep happens on the final header state, regardless of what any inner
 *   middleware (Strapi built-ins, Helmet, plugins) added or modified.
 *
 * ctx.remove() is a no-op when the header is absent, so the middleware is
 * safe to call unconditionally for every response.
 *
 * References: VAPT #14; OWASP Secure Headers Project; CWE-200 (Information
 *             Exposure); NIST SP 800-44 §4.3 (Web Server Banners)
 */

/** Headers that disclose server/framework identity. Lower-case, exact match. */
const BANNED_HEADERS = Object.freeze([
  'server',
  'x-powered-by',
  'via',
  'x-generator',
  'x-aspnet-version',
  'x-aspnetmvc-version',
]);

module.exports = (_config, _helpers) => {
  return async (ctx, next) => {
    // ── before-next: nothing to do ──────────────────────────────────────────
    await next();

    // ── after-next: sweep all identifying headers from outbound response ────
    // ctx.remove() is koa's header-removal method — no-op if header absent.
    for (const header of BANNED_HEADERS) {
      ctx.remove(header);
    }
  };
};

// Export the list for unit testing (property-based tests iterate over it).
module.exports.BANNED_HEADERS = BANNED_HEADERS;
