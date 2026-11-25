'use strict';

/**
 * P51 — Step-up fires on writes only, never on reads
 *
 * Original tester observation: "With MFA enabled, creating and editing an admin
 * user prompts the authenticator — and so does merely OPENING the user."
 *
 * classifyRoute() matched /admin/users[/:id] and /admin/roles[/:id] on ANY
 * method, GET included, and the fetch interceptor in src/admin/app.js turns any
 * 403 carrying { stepUpRequired: true } into the TOTP overlay — so a plain
 * `GET /admin/users` raised a popup. Step-up tokens are single-use (_usedJtis
 * in services/step-up.js), so the token minted for one read could not cover the
 * next: one popup per click.
 *
 * SCOPE NOTE — user_management and role_management were later removed from the
 * middleware entirely (see p54), so /admin/users** and /admin/roles** can no
 * longer be gated by any method. The read/write invariant this file guards now
 * applies to the two groups that remain: policy_management and password_change.
 * The user/role routes are still asserted here, but as "never gated at all".
 *
 * Covers:
 *   (A) No safe method reaches a protected group
 *   (B) The remaining groups are gated on their write verbs
 *   (C) /admin/users** and /admin/roles** are never gated, any method
 *   (D) /admin/users/me stays out of everything except its own password change
 */

const fc = require('fast-check');

const SAFE_METHODS  = ['GET', 'HEAD', 'OPTIONS'];
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function buildMiddleware({ tokenValid = true } = {}) {
  jest.resetModules();
  const factory = require('../server/middlewares/step-up-auth');
  const strapi = {
    config: {
      get: () => ({
        stepUp: { enabled: true, protectedRoutes: ['policy_management', 'password_change'] },
      }),
    },
    plugin: () => ({
      service: (name) => {
        if (name === 'stepUpConfig')   return { getEnabled: async () => true };
        if (name === 'adminLoginTotp') return { isPending: () => false };
        if (name === 'auditLogger')    return { log: jest.fn() };
        if (name === 'stepUp') {
          return {
            verifyStepUpToken: async () =>
              tokenValid ? { valid: true, payload: { sub: 1 } } : { valid: false, reason: 'invalid' },
          };
        }
        return {};
      },
    }),
  };
  return factory({}, { strapi });
}

function buildCtx({ method, path, body = {}, stepUpToken = '' }) {
  return {
    method, path, url: path,
    ip: '1.2.3.4',
    request: { ip: '1.2.3.4', body },
    state: {}, status: 200, body: null,
    get: (header) => (header === 'X-Step-Up-Token' ? stepUpToken : ''),
  };
}

async function isGated(ctx) {
  const middleware = buildMiddleware();
  const next = jest.fn(async () => {});
  await middleware(ctx, next);
  return {
    gated:      ctx.status === 403 && ctx.body?.error?.details?.stepUpRequired === true,
    routeGroup: ctx.body?.error?.details?.routeGroup ?? null,
    nextCalls:  next.mock.calls.length,
  };
}

const userRolePaths = [
  '/admin/users',
  '/admin/users/1',
  '/admin/users/batch-delete',
  '/admin/roles',
  '/admin/roles/1',
  '/admin/roles/1/permissions',
  '/admin/roles/batch-delete',
];

// ---------------------------------------------------------------------------
// A. Reads are never gated
// ---------------------------------------------------------------------------

describe('A — safe methods never trigger a step-up challenge', () => {
  test('property: no safe method on any admin route is gated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SAFE_METHODS),
        fc.constantFrom(...userRolePaths, '/erp-session-manager/config', '/admin/users/me'),
        async (method, path) => {
          const { gated, nextCalls } = await isGated(buildCtx({ method, path }));
          expect(gated).toBe(false);
          expect(nextCalls).toBe(1);
        }
      ),
      { numRuns: 60 }
    );
  });

  test('the originally reported flow — open Users list, then open one user', async () => {
    for (const path of ['/admin/users', '/admin/users/7']) {
      const { gated, nextCalls } = await isGated(buildCtx({ method: 'GET', path }));
      expect(gated).toBe(false);
      expect(nextCalls).toBe(1);
    }
  });

  test('GET on the policy route is a read — never gated', async () => {
    const { gated } = await isGated(buildCtx({ method: 'GET', path: '/erp-session-manager/config' }));
    expect(gated).toBe(false);
  });

  test('a query string does not smuggle a read past the method check', async () => {
    const ctx = buildCtx({ method: 'GET', path: '/admin/users' });
    ctx.url = '/admin/users?page=1&pageSize=10&sort=firstname:ASC';
    expect((await isGated(ctx)).gated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. The remaining groups gate their writes
// ---------------------------------------------------------------------------

describe('B — remaining groups are gated on write verbs', () => {
  test.each([['PUT'], ['PATCH']])('%s /erp-session-manager/config → policy_management', async (method) => {
    const { gated, routeGroup, nextCalls } = await isGated(
      buildCtx({ method, path: '/erp-session-manager/config' })
    );
    expect(gated).toBe(true);
    expect(routeGroup).toBe('policy_management');
    expect(nextCalls).toBe(0);
  });

  test('POST /admin/change-password → password_change', async () => {
    const { gated, routeGroup } = await isGated(
      buildCtx({ method: 'POST', path: '/admin/change-password' })
    );
    expect(gated).toBe(true);
    expect(routeGroup).toBe('password_change');
  });

  test('a valid step-up token lets the write through', async () => {
    const middleware = buildMiddleware({ tokenValid: true });
    const next = jest.fn(async () => {});
    const ctx = buildCtx({
      method: 'PUT', path: '/erp-session-manager/config', stepUpToken: 'valid-token',
    });
    await middleware(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// C. User and role routes are out of scope entirely
// ---------------------------------------------------------------------------

describe('C — user and role routes are never gated, by any method', () => {
  test('property: no method on any user/role route is gated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SAFE_METHODS, ...WRITE_METHODS),
        fc.constantFrom(...userRolePaths),
        async (method, path) => {
          const { gated } = await isGated(buildCtx({ method, path }));
          expect(gated).toBe(false);
        }
      ),
      { numRuns: 80 }
    );
  });

  test('a password on /admin/users/:id is not gated either', async () => {
    // Deliberate: that route is user management, which is fully removed.
    const { gated } = await isGated(
      buildCtx({ method: 'PUT', path: '/admin/users/3', body: { password: 'NewPass1!' } })
    );
    expect(gated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. /admin/users/me
// ---------------------------------------------------------------------------

describe('D — /admin/users/me is gated only on its own password change', () => {
  test('plain profile save passes through', async () => {
    const { gated, nextCalls } = await isGated(
      buildCtx({ method: 'PUT', path: '/admin/users/me', body: { firstname: 'Alice' } })
    );
    expect(gated).toBe(false);
    expect(nextCalls).toBe(1);
  });

  test('password change is password_change', async () => {
    const { gated, routeGroup } = await isGated(
      buildCtx({ method: 'PUT', path: '/admin/users/me', body: { currentPassword: 'old', password: 'new' } })
    );
    expect(gated).toBe(true);
    expect(routeGroup).toBe('password_change');
  });
});
