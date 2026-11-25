'use strict';

/**
 * P53 — VAPT: admin session cookie must carry Secure (and a strict SameSite)
 *
 * Tester observation (uat.cms.ultratechcableswires.com): the
 * `strapi_admin_refresh` / `strapi_admin_refresh.sig` cookies were served with
 * HttpOnly and SameSite=Lax but WITHOUT Secure, over HTTPS.
 *
 * Root cause: config/admin.js declared no `auth.cookie` block, so Strapi fell
 * back to inference in
 * @strapi/admin/dist/server/shared/utils/session-auth.js:
 *
 *     if (typeof configuredSecure === 'boolean') isSecure = configuredSecure;
 *     else if (secureRequest !== undefined)      isSecure = isProduction && secureRequest;
 *     else                                       isSecure = isProduction;
 *
 * `secureRequest` is `ctx.request.secure`, which Koa derives from
 * `socket.encrypted` or — only when `app.proxy` is true — X-Forwarded-Proto.
 * config/server.js set no `proxy`, so behind the TLS-terminating reverse proxy
 * `ctx.request.secure` was false on every request and the cookie never got the
 * flag, whatever NODE_ENV said. `sameSite` fell back to 'lax'.
 *
 * config/admin.js now sets both explicitly, so neither depends on proxy
 * detection. These tests exercise the real config factory.
 *
 * Covers:
 *   (A) The shipped config yields a boolean secure + strict sameSite
 *   (B) ADMIN_COOKIE_SECURE / ADMIN_COOKIE_SAMESITE override everything
 *   (C) The derivation: https URL → true, http URL → false, else NODE_ENV
 *   (D) Strapi's own resolver honours the boolean we hand it
 *   (E) config/server.js exposes the proxy flag, defaulting to off
 */

const fc = require('fast-check');

const ADMIN_CONFIG  = require('../../../../config/admin').default;
const SERVER_CONFIG = require('../../../../config/server').default;

// ---------------------------------------------------------------------------
// Harness — a stand-in for Strapi's `env` helper
// ---------------------------------------------------------------------------

function makeEnv(vars = {}) {
  const env = (key, def) => (vars[key] === undefined ? def : vars[key]);
  env.bool  = (key, def) => (vars[key] === undefined ? def : vars[key] === 'true' || vars[key] === true);
  env.int   = (key, def) => (vars[key] === undefined ? def : parseInt(vars[key], 10));
  env.array = (key, def) => (vars[key] === undefined ? def : String(vars[key]).split(','));
  return env;
}

function cookieConfig(vars = {}, nodeEnv) {
  const prev = process.env.NODE_ENV;
  if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
  try {
    return ADMIN_CONFIG({ env: makeEnv(vars) }).auth.cookie;
  } finally {
    process.env.NODE_ENV = prev;
  }
}

/**
 * Strapi's own resolver, transcribed from
 * @strapi/admin/dist/server/shared/utils/session-auth.js#getRefreshCookieOptions.
 * Used to prove our config actually reaches the flag Strapi emits.
 */
function strapiResolveSecure(configuredSecure, { isProduction, secureRequest }) {
  if (typeof configuredSecure === 'boolean') return configuredSecure;
  if (secureRequest !== undefined) return isProduction && secureRequest;
  return isProduction;
}

// ---------------------------------------------------------------------------
// A. The shipped config
// ---------------------------------------------------------------------------

describe('A — shipped config declares the cookie explicitly', () => {
  test('secure is a real boolean (Strapi only honours booleans, not strings)', () => {
    const c = cookieConfig({ API_URL: 'https://uat.cms.example.com' });
    expect(typeof c.secure).toBe('boolean');
  });

  test('sameSite defaults to strict, not Strapi\'s lax fallback', () => {
    expect(cookieConfig({}).sameSite).toBe('strict');
  });

  test('the reported environment now yields Secure', () => {
    // An HTTPS deployment, with the proxy NOT trusted — the exact situation
    // that produced the finding.
    expect(cookieConfig({ API_URL: 'https://uat.cms.ultratechcableswires.com' }).secure).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. Explicit override wins
// ---------------------------------------------------------------------------

describe('B — ADMIN_COOKIE_* overrides every inference', () => {
  test('ADMIN_COOKIE_SECURE=true wins over a plain-http URL', () => {
    expect(cookieConfig({ ADMIN_COOKIE_SECURE: 'true', API_URL: 'http://localhost:1337' }, 'development').secure).toBe(true);
  });

  test('ADMIN_COOKIE_SECURE=false wins over an https URL', () => {
    expect(cookieConfig({ ADMIN_COOKIE_SECURE: 'false', API_URL: 'https://x.example.com' }, 'production').secure).toBe(false);
  });

  test('ADMIN_COOKIE_SAMESITE overrides the strict default', () => {
    expect(cookieConfig({ ADMIN_COOKIE_SAMESITE: 'lax' }).sameSite).toBe('lax');
  });
});

// ---------------------------------------------------------------------------
// C. The derivation
// ---------------------------------------------------------------------------

describe('C — derivation when ADMIN_COOKIE_SECURE is unset', () => {
  test.each([
    ['https API_URL',         { API_URL: 'https://a.example.com' },    'development', true],
    ['https APP_URL',         { APP_URL: 'https://a.example.com' },    'development', true],
    ['https PUBLIC_URL',      { PUBLIC_URL: 'https://a.example.com' }, 'development', true],
    ['uppercase scheme',      { API_URL: 'HTTPS://a.example.com' },    'development', true],
    ['leading whitespace',    { API_URL: '  https://a.example.com' },  'development', true],
    ['http URL, dev',         { API_URL: 'http://localhost:1337' },    'development', false],
    ['http URL, production',  { API_URL: 'http://localhost:1337' },    'production',  false],
    ['no URL, production',    {},                                      'production',  true],
    ['no URL, development',   {},                                      'development', false],
  ])('%s', (_label, vars, nodeEnv, expected) => {
    expect(cookieConfig(vars, nodeEnv).secure).toBe(expected);
  });

  test('PUBLIC_URL takes precedence over APP_URL and API_URL', () => {
    expect(cookieConfig({
      PUBLIC_URL: 'https://public.example.com',
      APP_URL:    'http://app.example.com',
      API_URL:    'http://api.example.com',
    }, 'development').secure).toBe(true);
  });

  test('property: any https:// URL enables Secure regardless of NODE_ENV', () => {
    fc.assert(
      fc.property(fc.domain(), fc.constantFrom('development', 'production', 'test'), (host, nodeEnv) => {
        expect(cookieConfig({ PUBLIC_URL: `https://${host}` }, nodeEnv).secure).toBe(true);
      })
    );
  });
});

// ---------------------------------------------------------------------------
// D. Strapi honours what we hand it
// ---------------------------------------------------------------------------

describe('D — the flag survives Strapi\'s own resolver', () => {
  test('property: an explicit boolean beats proxy/NODE_ENV inference', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (configured, isProduction, secureRequest) => {
        expect(strapiResolveSecure(configured, { isProduction, secureRequest })).toBe(configured);
      })
    );
  });

  test('regression: without an explicit boolean, an untrusted proxy loses the flag', () => {
    // isProduction true, but ctx.request.secure false because app.proxy is off.
    expect(strapiResolveSecure(undefined, { isProduction: true, secureRequest: false })).toBe(false);
    // With our config supplying true, it holds.
    expect(strapiResolveSecure(true, { isProduction: true, secureRequest: false })).toBe(true);
  });

  test('end-to-end: shipped config → Secure even with the proxy untrusted', () => {
    const c = cookieConfig({ API_URL: 'https://uat.cms.ultratechcableswires.com' });
    expect(strapiResolveSecure(c.secure, { isProduction: false, secureRequest: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. The proxy flag
// ---------------------------------------------------------------------------

describe('E — config/server.js exposes the proxy flag', () => {
  // Strapi builds Koa with koa({ proxy: config.get('server.proxy.koa') }), so
  // the flag has to be nested. A bare `proxy: true` reads back as undefined,
  // Koa never trusts X-Forwarded-Proto, ctx.request.secure stays false, and
  // with ADMIN_COOKIE_SECURE=true every login dies on "Cannot send secure
  // cookie over unencrypted connection" — the UAT failure.
  test('the flag lives at server.proxy.koa, not server.proxy', () => {
    const cfg = SERVER_CONFIG({ env: makeEnv({ IS_PROXIED: 'true' }) });
    expect(typeof cfg.proxy).toBe('object');
    expect(cfg.proxy.koa).toBe(true);
  });

  test('defaults to false — trusting X-Forwarded-* must be opt-in', () => {
    expect(SERVER_CONFIG({ env: makeEnv({}) }).proxy.koa).toBe(false);
  });

  test('IS_PROXIED=true turns it on', () => {
    expect(SERVER_CONFIG({ env: makeEnv({ IS_PROXIED: 'true' }) }).proxy.koa).toBe(true);
  });

  test('regression: a bare boolean would leave server.proxy.koa undefined', () => {
    // Mirrors how Strapi reads it, to document why the nesting matters.
    const read = (cfg) => (cfg.proxy && typeof cfg.proxy === 'object' ? cfg.proxy.koa : undefined);
    expect(read({ proxy: true })).toBeUndefined();
    expect(read(SERVER_CONFIG({ env: makeEnv({ IS_PROXIED: 'true' }) }))).toBe(true);
  });
});
