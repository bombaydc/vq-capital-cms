'use strict';

/**
 * P54 — Step-up gates password changes, not user management
 *
 * Requested change: stop prompting for TOTP when an admin creates or edits a
 * user; prompt only when the request actually sets a password — in particular
 * the profile API (PUT /admin/users/me), where it must fire when the password
 * is being updated and stay silent otherwise.
 *
 * Two things make this more than deleting a string from protectedRoutes:
 *
 *   1. PUT /admin/users/:id classifies as user_management. With that group no
 *      longer protected, an admin setting SOMEONE ELSE'S password from
 *      Settings → Users would sail through ungated — anyone could overwrite a
 *      super-admin's password with no second factor, which is exactly what
 *      VAPT #4 exists to prevent. So password detection has to run BEFORE the
 *      path-based classification and win.
 *   2. The admin edit form submits an empty password field when it is left
 *      alone, so presence of the key is not enough — the value must be truthy.
 *
 * These tests read protectedRoutes from the SHIPPED config/plugins.js rather
 * than a hand-written list, so they fail if the deployed default drifts back.
 *
 * Covers:
 *   (A) The shipped config no longer protects user_management
 *   (B) User create / edit / delete are not gated
 *   (C) Every password-setting shape IS gated
 *   (D) A blank or absent password is not a password change
 *   (E) role_management / policy_management are untouched
 */

const fc = require('fast-check');

// The real deployed config — not a copy.
const PLUGINS_CONFIG = require('../../../../config/plugins').default;

function shippedStepUpConfig() {
  const env = (key, def) => def;
  env.bool  = (key, def) => def;
  env.int   = (key, def) => def;
  env.array = (key, def) => def;
  return PLUGINS_CONFIG({ env })['erp-session-manager'].config.stepUp;
}

// ---------------------------------------------------------------------------
// Harness — middleware wired to the shipped protectedRoutes
// ---------------------------------------------------------------------------

function buildMiddleware(protectedRoutes) {
  jest.resetModules();
  const factory = require('../server/middlewares/step-up-auth');
  const strapi = {
    config: { get: () => ({ stepUp: { enabled: true, protectedRoutes } }) },
    plugin: () => ({
      service: (name) => {
        if (name === 'stepUpConfig')   return { getEnabled: async () => true };
        if (name === 'adminLoginTotp') return { isPending: () => false };
        if (name === 'auditLogger')    return { log: jest.fn() };
        if (name === 'stepUp')         return { verifyStepUpToken: async () => ({ valid: true, payload: { sub: 1 } }) };
        return {};
      },
    }),
  };
  return factory({}, { strapi });
}

async function run({ method, path, body = {} }, protectedRoutes) {
  const middleware = buildMiddleware(protectedRoutes ?? shippedStepUpConfig().protectedRoutes);
  const next = jest.fn(async () => {});
  const ctx = {
    method, path, url: path,
    ip: '1.2.3.4',
    request: { ip: '1.2.3.4', body },
    state: {}, status: 200, body: null,
    get: () => '',            // no step-up token
  };
  await middleware(ctx, next);
  return {
    gated:      ctx.status === 403 && ctx.body?.error?.details?.stepUpRequired === true,
    routeGroup: ctx.body?.error?.details?.routeGroup ?? null,
    passedThrough: next.mock.calls.length === 1,
  };
}

// ---------------------------------------------------------------------------
// A. Shipped config
// ---------------------------------------------------------------------------

describe('A — shipped config', () => {
  test('user_management is not in protectedRoutes', () => {
    expect(shippedStepUpConfig().protectedRoutes).not.toContain('user_management');
  });

  test('password_change still is', () => {
    expect(shippedStepUpConfig().protectedRoutes).toContain('password_change');
  });
});

// ---------------------------------------------------------------------------
// B. User management is no longer gated
// ---------------------------------------------------------------------------

describe('B — creating / editing / deleting a user does not prompt', () => {
  test.each([
    ['create user',      'POST',   '/admin/users',              { email: 'a@b.c', firstname: 'A', roles: [1] }],
    ['edit user',        'PUT',    '/admin/users/3',            { firstname: 'Updated', lastname: 'Name' }],
    ['toggle isActive',  'PUT',    '/admin/users/3',            { isActive: false }],
    ['change roles',     'PUT',    '/admin/users/3',            { roles: [2] }],
    ['delete user',      'DELETE', '/admin/users/3',            {}],
    ['bulk delete',      'POST',   '/admin/users/batch-delete', { ids: [3, 4] }],
    ['profile, no pw',   'PUT',    '/admin/users/me',           { firstname: 'Alice' }],
  ])('%s → no TOTP', async (_label, method, path, body) => {
    const r = await run({ method, path, body });
    expect(r.gated).toBe(false);
    expect(r.passedThrough).toBe(true);
  });

  test('property: any non-password user write passes through', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
        fc.constantFrom('/admin/users', '/admin/users/3', '/admin/users/me', '/admin/users/batch-delete'),
        fc.record({ firstname: fc.string(), lastname: fc.string(), isActive: fc.boolean() }),
        async (method, path, body) => {
          const r = await run({ method, path, body });
          expect(r.gated).toBe(false);
        }
      ),
      { numRuns: 60 }
    );
  });
});

// ---------------------------------------------------------------------------
// C. Password changes ARE gated
// ---------------------------------------------------------------------------

describe('C — the signed-in admin changing their OWN password prompts', () => {
  test.each([
    ['profile page, password + currentPassword', 'PUT',  '/admin/users/me', { currentPassword: 'old', password: 'NewPass1!' }],
    ['profile page, password only',              'PUT',  '/admin/users/me', { password: 'NewPass1!' }],
    ['profile page, currentPassword only',       'PUT',  '/admin/users/me', { currentPassword: 'old' }],
    ['password alongside other fields',          'PUT',  '/admin/users/me', { firstname: 'A', password: 'NewPass1!' }],
    ['legacy change-password endpoint',          'POST', '/admin/change-password', { password: 'NewPass1!' }],
  ])('%s → TOTP required', async (_label, method, path, body) => {
    const r = await run({ method, path, body });
    expect(r.gated).toBe(true);
    expect(r.routeGroup).toBe('password_change');
    expect(r.passedThrough).toBe(false);
  });

  test('property: any non-empty password on /admin/users/me is gated', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (password) => {
        const r = await run({ method: 'PUT', path: '/admin/users/me', body: { password } });
        expect(r.gated).toBe(true);
        expect(r.routeGroup).toBe('password_change');
      }),
      { numRuns: 60 }
    );
  });

  test('an admin setting ANOTHER user\'s password is NOT gated', async () => {
    // Deliberate, and the one real security cost of removing user_management:
    // Settings → Users can reset any account's password with no second factor.
    // Restoring it means re-adding the /admin/users/:id branch to
    // isPasswordChangeRequest().
    for (const path of ['/admin/users/3', '/admin/users/77']) {
      const r = await run({ method: 'PUT', path, body: { password: 'NewPass1!' } });
      expect(r.gated).toBe(false);
      expect(r.passedThrough).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// D. Blank password is not a password change
// ---------------------------------------------------------------------------

describe('D — an untouched password field does not prompt', () => {
  test.each([
    ['empty string',      { firstname: 'A', password: '' }],
    ['null',              { firstname: 'A', password: null }],
    ['undefined',         { firstname: 'A', password: undefined }],
    ['absent',            { firstname: 'A' }],
  ])('%s → no TOTP', async (_label, body) => {
    for (const path of ['/admin/users/me', '/admin/users/3']) {
      const r = await run({ method: 'PUT', path, body });
      expect(r.gated).toBe(false);
    }
  });

  test('a missing body does not throw', async () => {
    const r = await run({ method: 'PUT', path: '/admin/users/me', body: null });
    expect(r.gated).toBe(false);
    expect(r.passedThrough).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. Other groups unchanged
// ---------------------------------------------------------------------------

describe('E — roles are no longer gated; policy still is', () => {
  test.each([
    ['create role',      'POST',   '/admin/roles'],
    ['edit role',        'PUT',    '/admin/roles/1'],
    ['role permissions', 'PUT',    '/admin/roles/1/permissions'],
    ['delete role',      'DELETE', '/admin/roles/1'],
    ['bulk delete role', 'POST',   '/admin/roles/batch-delete'],
  ])('%s → no TOTP', async (_label, method, path) => {
    const r = await run({ method, path, body: {} });
    expect(r.gated).toBe(false);
    expect(r.passedThrough).toBe(true);
  });

  test('policy update is still gated', async () => {
    const r = await run({ method: 'PUT', path: '/erp-session-manager/config', body: {} });
    expect(r.gated).toBe(true);
    expect(r.routeGroup).toBe('policy_management');
  });

  test('shipped config lists neither user_management nor role_management', () => {
    const routes = shippedStepUpConfig().protectedRoutes;
    expect(routes).not.toContain('user_management');
    expect(routes).not.toContain('role_management');
    expect(routes).toEqual(expect.arrayContaining(['password_change', 'policy_management']));
  });

  test('re-listing the removed names in config does nothing — the matchers are gone', async () => {
    const r = await run(
      { method: 'POST', path: '/admin/users', body: {} },
      ['user_management', 'role_management', 'policy_management', 'password_change']
    );
    expect(r.gated).toBe(false);
    expect(r.passedThrough).toBe(true);
  });

  test('reads are still never gated', async () => {
    for (const path of ['/admin/users', '/admin/users/3', '/admin/roles']) {
      expect((await run({ method: 'GET', path })).gated).toBe(false);
    }
  });
});
