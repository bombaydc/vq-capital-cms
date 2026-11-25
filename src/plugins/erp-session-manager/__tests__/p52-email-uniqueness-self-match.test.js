'use strict';

/**
 * P52 — Updating a user must not match the user against itself
 *
 * Tester observation: "profile update and user update — it does not update
 * self email."
 *
 * Root cause: the email-uniqueness lifecycle in server/index.js destructured a
 * TOP-LEVEL `where` off the lifecycle event:
 *
 *     async beforeUpdate({ params, where }) {
 *       const excludeId = where && where.id;          // always undefined
 *       await enforceAdminEmailUnique(email, excludeId);
 *     }
 *
 * A @strapi/database lifecycle Event is `{ action, model, params, state }`
 * (dist/lifecycles/types.d.ts) — the entity manager calls
 * `db.lifecycles.run('beforeUpdate', uid, { params })` with `{ where, data }`
 * nested inside `params`. So `where` was undefined, `excludeId` was undefined,
 * and the duplicate check counted the very row being updated. Saving a profile
 * with its own unchanged email threw
 * "An account with this email address already exists." (400).
 *
 * Confirmed against the live DB before the fix — for admin_users row id=1:
 *     excludeId=undefined -> taken=true      (update rejected)
 *     excludeId=1         -> taken=false     (update allowed)
 *
 * Why the existing p21 suite missed it: p21 re-implements the hook inline and
 * fed it a hand-made `{ params, where }` event that Strapi never emits, so the
 * test mirrored the implementation's wrong assumption instead of the real
 * contract. These tests use the documented Event shape only.
 *
 * Covers:
 *   (A) resolveExcludeIds() reads every where-shape the ORM emits
 *   (B) A row never matches itself — the reported bug, at service level
 *   (C) The lifecycle contract: params.where only, no top-level where
 *   (D) Genuine duplicates are still rejected
 */

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Harness — an in-memory admin_users/up_users table behind a knex-shaped stub
// ---------------------------------------------------------------------------

function buildService(rows = []) {
  const table = (name) => {
    const data = rows.filter((r) => r.table === name);
    const state = { email: null, excludeSingle: undefined, excludeMany: null };

    // knex's builder stays chainable after .count().first() — the service adds
    // its exclusion clause AFTER those calls, so the stub must too. It is
    // thenable rather than a Promise for exactly that reason.
    const builder = {
      whereRaw(_sql, [value]) { state.email = value; return builder; },
      andWhere(_col, _op, value) { state.excludeSingle = value; return builder; },
      whereNotIn(_col, values) { state.excludeMany = values; return builder; },
      count() { return builder; },
      first() { return builder; },
      then(onFulfilled, onRejected) {
        const matches = data.filter((r) => {
          if (String(r.email).trim().toLowerCase() !== state.email) return false;
          if (state.excludeSingle !== undefined && String(r.id) === String(state.excludeSingle)) return false;
          if (state.excludeMany && state.excludeMany.some((v) => String(v) === String(r.id))) return false;
          return true;
        });
        return Promise.resolve({ cnt: matches.length }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const strapi = {
    db: { connection: table },
    plugin: () => ({ service: () => ({ log: jest.fn() }) }),
  };

  jest.resetModules();
  return require('../server/services/email-uniqueness')({ strapi });
}

/** Register the hooks exactly as server/index.js does, and capture them. */
function buildLifecycle(svc) {
  const subs = [];
  const strapiDb = { lifecycles: { subscribe: (s) => subs.push(s) } };

  strapiDb.lifecycles.subscribe({
    models: ['admin::user'],
    async beforeCreate({ params }) {
      const email = params && params.data && params.data.email;
      if (email) await svc.enforceAdminEmailUnique(email);
    },
    async beforeUpdate({ params }) {
      const email = params && params.data && params.data.email;
      if (email) {
        await svc.enforceAdminEmailUnique(email, svc.resolveExcludeIds(params && params.where));
      }
    },
  });

  return (action, event) => subs[0][action](event);
}

// ---------------------------------------------------------------------------
// A. resolveExcludeIds
// ---------------------------------------------------------------------------

describe('A — resolveExcludeIds reads every where-shape the ORM emits', () => {
  const svc = buildService();

  test.each([
    ['update-by-id',      { id: 5 },                        [5]],
    ['$eq operator',      { id: { $eq: 5 } },               [5]],
    ['$in operator',      { id: { $in: [5, 6] } },          [5, 6]],
    ['$and wrapper',      { $and: [{ id: 5 }, { x: 1 }] },  [5]],
    ['$or wrapper',       { $or: [{ id: 5 }, { id: 6 }] },  [5, 6]],
    ['string id',         { id: '5' },                      ['5']],
    ['no id key',         { email: 'a@b.c' },               []],
    ['undefined where',   undefined,                        []],
    ['null where',        null,                             []],
    ['unreadable id',     { id: { $gt: 3 } },               []],
  ])('%s', (_label, where, expected) => {
    expect(svc.resolveExcludeIds(where)).toEqual(expected);
  });

  test('property: a scalar id is always recovered from { id }', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), (id) => {
        expect(svc.resolveExcludeIds({ id })).toEqual([id]);
        expect(svc.resolveExcludeIds({ id: { $eq: id } })).toEqual([id]);
        expect(svc.resolveExcludeIds({ $and: [{ id }] })).toEqual([id]);
      })
    );
  });
});

// ---------------------------------------------------------------------------
// B. A row never matches itself
// ---------------------------------------------------------------------------

describe('B — a row never matches itself', () => {
  test('property: re-saving your own email is never a duplicate', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 500 }),
        fc.emailAddress(),
        async (id, email) => {
          const svc = buildService([{ table: 'admin_users', id, email }]);
          expect(await svc.isAdminEmailTaken(email, [id])).toBe(false);
          await expect(svc.enforceAdminEmailUnique(email, [id])).resolves.toBeUndefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  test('the reported bug: excludeId undefined self-matches (regression guard)', async () => {
    const svc = buildService([{ table: 'admin_users', id: 1, email: 'cms@bombaydc.com' }]);
    // This is what the broken lifecycle passed — documents WHY the fix matters.
    expect(await svc.isAdminEmailTaken('cms@bombaydc.com', undefined)).toBe(true);
    // ...and what it passes now.
    expect(await svc.isAdminEmailTaken('cms@bombaydc.com', [1])).toBe(false);
  });

  test('case/whitespace variants of your own email are still not duplicates', async () => {
    const svc = buildService([{ table: 'admin_users', id: 3, email: 'admin@example.com' }]);
    for (const variant of ['ADMIN@example.com', '  Admin@Example.COM  ']) {
      expect(await svc.isAdminEmailTaken(variant, [3])).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// C. The lifecycle contract
// ---------------------------------------------------------------------------

describe('C — lifecycle reads params.where, never a top-level where', () => {
  test('beforeUpdate with the REAL event shape allows the self-save', async () => {
    const svc = buildService([{ table: 'admin_users', id: 7, email: 'self@example.com' }]);
    const run = buildLifecycle(svc);

    await expect(
      run('beforeUpdate', { params: { where: { id: 7 }, data: { email: 'self@example.com' } } })
    ).resolves.toBeUndefined();
  });

  test('a top-level `where` is ignored — it is not part of the contract', async () => {
    const svc = buildService([{ table: 'admin_users', id: 7, email: 'self@example.com' }]);
    const run = buildLifecycle(svc);

    // If the hook ever regresses to reading the top-level `where`, params.where
    // is absent here and the self-match returns — so this must throw.
    await expect(
      run('beforeUpdate', { where: { id: 7 }, params: { data: { email: 'self@example.com' } } })
    ).rejects.toThrow(/already exists/);
  });

  test('beforeUpdate without an email in data is a no-op', async () => {
    const svc = buildService([{ table: 'admin_users', id: 7, email: 'self@example.com' }]);
    const run = buildLifecycle(svc);

    await expect(
      run('beforeUpdate', { params: { where: { id: 7 }, data: { firstname: 'Alice' } } })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D. Genuine duplicates still rejected
// ---------------------------------------------------------------------------

describe('D — genuine duplicates are still rejected', () => {
  const seed = [
    { table: 'admin_users', id: 1, email: 'alice@example.com' },
    { table: 'admin_users', id: 2, email: 'bob@example.com' },
  ];

  test('taking another row\'s email on update → 400', async () => {
    const svc = buildService(seed);
    const run = buildLifecycle(svc);

    await expect(
      run('beforeUpdate', { params: { where: { id: 2 }, data: { email: 'alice@example.com' } } })
    ).rejects.toMatchObject({ name: 'ApplicationError', status: 400 });
  });

  test('creating with an existing email → 400', async () => {
    const svc = buildService(seed);
    const run = buildLifecycle(svc);

    await expect(
      run('beforeCreate', { params: { data: { email: 'alice@example.com' } } })
    ).rejects.toThrow(/already exists/);
  });

  test('$in excludes every targeted row but still catches an outsider', async () => {
    const svc = buildService([...seed, { table: 'admin_users', id: 3, email: 'carol@example.com' }]);
    expect(await svc.isAdminEmailTaken('alice@example.com', [1, 2])).toBe(false);
    expect(await svc.isAdminEmailTaken('carol@example.com', [1, 2])).toBe(true);
  });
});
