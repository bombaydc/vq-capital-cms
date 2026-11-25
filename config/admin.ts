import type { Core } from '@strapi/strapi';

type Env = Core.Config.Shared.ConfigParams['env'];

/**
 * Default for the admin refresh cookie's `Secure` attribute.
 *
 * Strapi only marks `strapi_admin_refresh` Secure when the option is an
 * explicit boolean, or when NODE_ENV=production AND ctx.request.secure is true.
 * Behind a TLS-terminating proxy ctx.request.secure is false unless
 * IS_PROXIED=true, so the inferred path fails exactly where it matters.
 *
 * Precedence: ADMIN_COOKIE_SECURE > https public URL > NODE_ENV.
 */
const resolveSecureCookieDefault = (env: Env): boolean => {
  const publicUrl = (env('PUBLIC_URL', '') || env('APP_URL', '') || env('API_URL', '')).trim();
  if (/^https:\/\//i.test(publicUrl)) return true;
  if (/^http:\/\//i.test(publicUrl)) return false;
  return process.env.NODE_ENV === 'production';
};

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Admin => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET')!,

    // VAPT — admin session cookie missing Secure / weak SameSite.
    // Set ADMIN_COOKIE_SECURE=true in every HTTPS environment.
    cookie: {
      secure: env.bool('ADMIN_COOKIE_SECURE', resolveSecureCookieDefault(env)),
      sameSite: env('ADMIN_COOKIE_SAMESITE', 'strict') as 'strict' | 'lax' | 'none',
    },

    // VAPT #7 — Long-lived JWT. Boot-time defaults only: the ERP plugin
    // re-applies the live idle timeout from Settings → Policy at startup and
    // on every save (policy.js → _syncAdminSessionLifespans).
    sessions: {
      accessTokenLifespan: 15 * 60, // 15 min (default 30 min)
      maxRefreshTokenLifespan: 8 * 60 * 60, // 8 h (default 30 days)
      idleRefreshTokenLifespan: 15 * 60, // 15 min (default 7 days)
      maxSessionLifespan: 8 * 60 * 60, // 8 h (default 30 days)
      idleSessionLifespan: 15 * 60, // 15 min (default 1 h)
    },
  },
  apiToken: {
    salt: env('API_TOKEN_SALT')!,
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT')!,
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY')!,
  },
  flags: {
    nps: env.bool('FLAG_NPS', false),
    // false hides the Enterprise-only upsell links (Content History, Releases,
    // Review Workflows, SSO, Audit Logs) — no CE features are lost.
    promoteEE: env.bool('FLAG_PROMOTE_EE', false),
    docLinks: env.bool('FLAG_DOC_LINKS', true),
  },
});

export default config;
