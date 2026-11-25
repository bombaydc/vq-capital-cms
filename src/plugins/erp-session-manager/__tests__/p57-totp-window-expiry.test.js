'use strict';

/**
 * P57 — Waiting out the post-login TOTP window must not grant access
 *
 * The post-login gate (adminLoginTotp) held a pending entry for 10 minutes.
 * isPending() deleted the entry the moment it expired and returned false, and
 * the middleware read false as "no second factor needed":
 *
 *     if (!adminLoginTotpSvc.isPending(adminUserId)) return true;   // allowed
 *
 * So an attacker holding only the password could log in, ignore the modal for
 * ten minutes, and then use the session that the password step had already
 * issued — full admin access with no code ever entered. Measured before the
 * fix: BLOCKED at 0 min, ALLOWED THROUGH at 11 min. Waiting was the attack.
 *
 * An expired entry is now retained: it is the only evidence that this user was
 * gated and never finished. getState() reports 'expired' distinctly, and the
 * middleware ends the session instead of opening the gate.
 *
 * Covers:
 *   (A) getState distinguishes none / pending / expired
 *   (B) The bypass is closed — an expired gate never passes the middleware
 *   (C) Expiry revokes BOTH session layers and answers 401 totpExpired
 *   (D) Revocation failure keeps the gate shut (fail closed)
 *   (E) Recovery paths stay reachable, and a fresh login resets the gate
 */

const fc  = require('fast-check');
const jwt = require('jsonwebtoken');

const MINUTE = 60 * 1000;
const TTL    = 10 * MINUTE;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function freshService() {
  jest.resetModules();
  return require('../server/services/admin-login-totp')({ strapi: {} });
}

/**
 * Run `fn` as though the clock had advanced by `ms`.
 *
 * Async-aware on purpose: the middleware awaits getEnabled() before it reads
 * the clock, so a synchronous try/finally would restore Date.now BEFORE the
 * gate check ran and every time-travel assertion would silently test the
 * present instead.
 */
async function at(ms, fn) {
  const real = Date.now;
  const base = real();
  Date.now = () => base + ms;
  try { return await fn(); } finally { Date.now = real; }
}

function buildMiddleware({ totpSvc, invalidate, revokeAll, hasAdminOrigin = true } = {}) {
  jest.resetModules();
  const factory = require('../server/middlewares/step-up-auth');

  const sessionManager = (origin) => ({
    invalidateRefreshToken: invalidate || (async () => {}),
    origin,
  });
  sessionManager.hasOrigin = () => hasAdminOrigin;

  const strapi = {
    log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    sessionManager,
    config: { get: () => ({ stepUp: { enabled: true, protectedRoutes: ['policy_management', 'password_change'] } }) },
    plugin: () => ({
      service: (name) => {
        if (name === 'stepUpConfig')   return { getEnabled: async () => true };
        if (name === 'adminLoginTotp') return totpSvc;
        if (name === 'auditLogger')    return { log: jest.fn() };
        if (name === 'session')        return { revokeAllForUser: revokeAll || (async () => 1) };
        if (name === 'stepUp')         return { verifyStepUpToken: async () => ({ valid: true, payload: { sub: 1 } }) };
        return {};
      },
    }),
  };
  return factory({}, { strapi });
}

function ctxFor(userId, path = '/admin/content-manager/collection-types/api::article.article') {
  const token = jwt.sign({ id: userId }, 'test-secret');
  return {
    method: 'GET', path, url: path,
    ip: '1.2.3.4',
    request: { ip: '1.2.3.4', body: {} },
    state: {}, status: 200, body: null,
    get: (h) => (String(h).toLowerCase() === 'authorization' ? `Bearer ${token}` : ''),
  };
}

async function run(ctx, mw) {
  const next = jest.fn(async () => {});
  await mw(ctx, next);
  return { status: ctx.status, body: ctx.body, allowed: next.mock.calls.length === 1 };
}

// ---------------------------------------------------------------------------
// A. State machine
// ---------------------------------------------------------------------------

describe('A — getState tells expired apart from never-gated', () => {
  test('no entry → none', () => {
    expect(freshService().getState(42)).toBe('none');
  });

  test('inside the window → pending', async () => {
    const svc = freshService();
    svc.require(42);
    expect(svc.getState(42)).toBe('pending');
    await at(9 * MINUTE, () => expect(svc.getState(42)).toBe('pending'));
  });

  test('past the window → expired, NOT none', async () => {
    const svc = freshService();
    svc.require(42);
    at(TTL + MINUTE, () => {
      expect(svc.getState(42)).toBe('expired');
      expect(svc.isPending(42)).toBe(false);
      expect(svc.isExpired(42)).toBe(true);
    });
  });

  test('property: the state is never none while a gate is unfinished', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 23 * 60 }), async (minutes) => {
        const svc = freshService();
        svc.require(42);
        at(minutes * MINUTE, () => {
          expect(svc.getState(42)).not.toBe('none');
        });
      })
    );
  });

  test('very old entries are swept so the map cannot grow forever', async () => {
    const svc = freshService();
    svc.require(42);
    await at(25 * 60 * MINUTE, () => expect(svc.getState(42)).toBe('none'));
  });

  test('clear() after a successful code returns it to none', () => {
    const svc = freshService();
    svc.require(42);
    svc.clear(42);
    expect(svc.getState(42)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// B. The bypass is closed
// ---------------------------------------------------------------------------

describe('B — waiting out the window does not grant access', () => {
  test('the reported attack: blocked at 0 min, still blocked at 11 min', async () => {
    const totpSvc = freshService();
    totpSvc.require(42);

    const before = await run(ctxFor(42), buildMiddleware({ totpSvc }));
    expect(before.status).toBe(403);
    expect(before.allowed).toBe(false);

    const after = await at(11 * MINUTE, () => run(ctxFor(42), buildMiddleware({ totpSvc })));
    expect(after.allowed).toBe(false);
    expect(after.status).toBe(401);
  });

  test('property: never allowed at any point in the first 23 hours', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 23 * 60 }), async (minutes) => {
        const totpSvc = freshService();
        totpSvc.require(42);
        const r = await at(minutes * MINUTE, () => run(ctxFor(42), buildMiddleware({ totpSvc })));
        expect(r.allowed).toBe(false);
      }),
      { numRuns: 60 }
    );
  });

  test('an ungated user is unaffected', async () => {
    const totpSvc = freshService();           // nobody required
    const r = await run(ctxFor(99), buildMiddleware({ totpSvc }));
    expect(r.allowed).toBe(true);
    expect(r.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// C. Expiry ends the session
// ---------------------------------------------------------------------------

describe('C — expiry revokes both session layers and answers 401', () => {
  test('invalidateRefreshToken and revokeAllForUser are both called', async () => {
    const totpSvc    = freshService();
    const invalidate = jest.fn(async () => {});
    const revokeAll  = jest.fn(async () => 2);
    totpSvc.require(42);

    const r = await at(11 * MINUTE, () =>
      run(ctxFor(42), buildMiddleware({ totpSvc, invalidate, revokeAll })));

    expect(invalidate).toHaveBeenCalledWith('42');
    expect(revokeAll).toHaveBeenCalledWith(42);
    expect(r.status).toBe(401);
    expect(r.body.error.details.totpExpired).toBe(true);
    expect(r.body.error.message).toMatch(/sign in again/i);
  });

  test('the gate is cleared once the session is really gone', async () => {
    const totpSvc = freshService();
    totpSvc.require(42);
    await at(11 * MINUTE, () => run(ctxFor(42), buildMiddleware({ totpSvc })));
    expect(totpSvc.getState(42)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// D. Fail closed
// ---------------------------------------------------------------------------

describe('D — a failed revocation keeps the gate shut', () => {
  test.each([
    ['strapi session manager throws', { invalidate: async () => { throw new Error('db down'); } }],
    ['ERP revocation throws',         { revokeAll:  async () => { throw new Error('db down'); } }],
  ])('%s → still 401, entry retained', async (_label, overrides) => {
    const totpSvc = freshService();
    totpSvc.require(42);

    const r = await at(11 * MINUTE, () =>
      run(ctxFor(42), buildMiddleware({ totpSvc, ...overrides })));

    expect(r.status).toBe(401);
    expect(r.allowed).toBe(false);
    // Not cleared — the next request must try again rather than let them in.
    await at(11 * MINUTE, () => expect(totpSvc.getState(42)).toBe('expired'));
  });

  test('a later request after a failed revocation is still refused', async () => {
    const totpSvc = freshService();
    totpSvc.require(42);
    const failing = { invalidate: async () => { throw new Error('db down'); } };

    await at(11 * MINUTE, () => run(ctxFor(42), buildMiddleware({ totpSvc, ...failing })));
    const second = await at(12 * MINUTE, () => run(ctxFor(42), buildMiddleware({ totpSvc, ...failing })));

    expect(second.allowed).toBe(false);
    expect(second.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// E. Recovery
// ---------------------------------------------------------------------------

describe('E — the user can still get back in', () => {
  test.each([['/admin/login'], ['/admin/logout']])('%s stays reachable when expired', async (path) => {
    const totpSvc = freshService();
    totpSvc.require(42);
    const r = await at(11 * MINUTE, () => run(ctxFor(42, path), buildMiddleware({ totpSvc })));
    expect(r.allowed).toBe(true);
    expect(r.status).not.toBe(401);
  });

  test('logging in again re-arms a fresh window', async () => {
    const svc = freshService();
    svc.require(42);
    await at(11 * MINUTE, () => {
      expect(svc.getState(42)).toBe('expired');
      svc.require(42);                       // the new login
      expect(svc.getState(42)).toBe('pending');
    });
  });

  test('a setup-required gate expires the same way', async () => {
    const svc = freshService();
    svc.requireSetup(42, { provisioningUri: 'otpauth://x', base32Secret: 'S', qrCodeDataUri: null });
    expect(svc.isSetupRequired(42)).toBe(true);
    await at(11 * MINUTE, () => {
      expect(svc.getState(42)).toBe('expired');
      expect(svc.isSetupRequired(42)).toBe(false);
      expect(svc.getSetupData(42)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// F. The gate covers everything the half-authenticated session can reach
// ---------------------------------------------------------------------------

describe('F — enforcement is complete while the gate is enabled', () => {
  // The gate used to test only ctx.path.startsWith('/admin/'). This plugin's
  // own admin API lives at /erp-session-manager/*, so all of it was reachable
  // from an unanswered TOTP modal — sessions, audit logs, the activity log
  // (which stores request bodies) and the security policy.
  const PLUGIN_ROUTES = [
    '/erp-session-manager/sessions',
    '/erp-session-manager/audit-logs',
    '/erp-session-manager/audit-logs/export',
    '/erp-session-manager/activity-logs',
    '/erp-session-manager/policy',
    '/erp-session-manager/config',
    '/erp-session-manager/permissions',
  ];

  test.each(PLUGIN_ROUTES)('pending gate blocks %s', async (path) => {
    const totpSvc = freshService();
    totpSvc.require(42);
    const r = await run(ctxFor(42, path), buildMiddleware({ totpSvc }));
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body.error.details.totpPending).toBe(true);
  });

  test.each(PLUGIN_ROUTES)('expired gate ends the session on %s', async (path) => {
    const totpSvc = freshService();
    totpSvc.require(42);
    const r = await at(11 * MINUTE, () => run(ctxFor(42, path), buildMiddleware({ totpSvc })));
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(401);
  });

  test('the step-up endpoints stay reachable — they are how you clear the gate', async () => {
    for (const path of [
      '/erp-session-manager/step-up/admin-login-totp',
      '/erp-session-manager/step-up/setup',
      '/erp-session-manager/step-up/setup/verify',
      '/erp-session-manager/step-up/status',
    ]) {
      const totpSvc = freshService();
      totpSvc.require(42);
      const r = await run(ctxFor(42, path), buildMiddleware({ totpSvc }));
      expect(r.allowed).toBe(true);
    }
  });

  test('content-API paths are not touched — they have their own gate', async () => {
    const totpSvc = freshService();
    totpSvc.require(42);
    const r = await run(ctxFor(42, '/api/erp-session-manager/captcha/challenge'),
                        buildMiddleware({ totpSvc }));
    expect(r.allowed).toBe(true);
  });

  test('property: no admin or plugin path escapes a pending gate', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('/admin/', '/erp-session-manager/'),
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('?') && !s.includes('#')),
        async (prefix, tail) => {
          if (`${prefix}${tail}`.startsWith('/erp-session-manager/step-up/')) return;
          if (`${prefix}${tail}` === '/admin/login' || `${prefix}${tail}` === '/admin/logout') return;
          const totpSvc = freshService();
          totpSvc.require(42);
          const r = await run(ctxFor(42, `${prefix}${tail}`), buildMiddleware({ totpSvc }));
          expect(r.allowed).toBe(false);
        }
      ),
      { numRuns: 80 }
    );
  });
});
