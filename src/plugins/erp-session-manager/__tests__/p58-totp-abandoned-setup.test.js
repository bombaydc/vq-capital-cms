'use strict';

/**
 * P58 — Abandoning the TOTP setup screen must not lock the account out
 *
 * provisionSecret() writes the secret row BEFORE the QR code reaches the
 * browser. getStatus() reported `provisioned: true` for any row that existed,
 * so the two states below were indistinguishable:
 *
 *   a secret the user scanned and confirmed
 *   a secret nobody ever saw, because the tab was closed on the QR screen
 *
 * The login gate read the second as the first:
 *
 *     if (status.provisioned) adminLoginTotpSvc.require(userId);   // "enter your code"
 *
 * so the next login demanded a 6-digit code from an authenticator that had
 * never received the secret. There is no way out of that from the browser —
 * the QR is never offered again — and it needed a DB edit to recover.
 *
 * `confirmedAt` now records the moment a code from the secret verified.
 * `lastUsedAt` counts as confirmation too, so secrets provisioned before the
 * column existed are not invalidated by the fix.
 *
 * Covers:
 *   (A) getStatus tells confirmed from abandoned
 *   (B) The lockout is closed — an abandoned setup routes back to the QR
 *   (C) Confirming stamps confirmedAt, through both verification paths
 *   (D) An abandoned secret is re-shown, not regenerated
 */

const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'p58-test-encryption-key';
});

afterAll(() => {
  if (ORIGINAL_ENCRYPTION_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY;
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Minimal strapi double backing a single erp-step-up-secret row.
 * `state.record` is the stored row; `state.created` / `state.updated` record
 * what the service wrote, so a test can assert on writes rather than guess.
 */
function makeStrapi({ record = null } = {}) {
  const state = { record, created: [], updated: [] };

  const strapi = {
    log: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
    config: { get: () => ({ stepUp: { clockSkewSeconds: 30 } }) },
    documents: () => ({
      findFirst: async () => state.record,
      create: async ({ data }) => {
        state.created.push(data);
        state.record = { documentId: `doc-${state.created.length}`, ...data };
        return state.record;
      },
      update: async ({ data }) => {
        state.updated.push(data);
        state.record = { ...state.record, ...data };
        return state.record;
      },
      delete: async () => { state.record = null; },
    }),
    db: { query: () => ({ findOne: async () => ({ email: 'qa@example.test' }) }) },
    plugin: () => ({ service: () => ({ log: jest.fn() }) }),
  };

  return { strapi, state, service: require('../server/services/step-up')({ strapi }) };
}

/** A stored row shaped like provisionSecret writes it, with the timestamps under test. */
function storedRow({ confirmedAt = null, lastUsedAt = null } = {}) {
  return {
    documentId:      'doc-existing',
    userId:          42,
    encryptedSecret: 'aa',
    iv:              'bb',
    authTag:         'cc',
    provisionedAt:   new Date().toISOString(),
    confirmedAt,
    lastUsedAt,
  };
}

// ---------------------------------------------------------------------------
// (A) getStatus tells confirmed from abandoned
// ---------------------------------------------------------------------------

describe('A — getStatus reports usability, not row existence', () => {
  test('no row at all: nothing provisioned, nothing pending', async () => {
    const { service } = makeStrapi({ record: null });
    await expect(service.getStatus(42)).resolves.toMatchObject({
      provisioned:  false,
      pendingSetup: false,
    });
  });

  test('THE BUG: a row with neither timestamp is an abandoned setup, not a configured account', async () => {
    const { service } = makeStrapi({ record: storedRow() });
    const status = await service.getStatus(42);

    // Before the fix this said provisioned:true and the user was locked out.
    expect(status.provisioned).toBe(false);
    expect(status.pendingSetup).toBe(true);
  });

  test('confirmedAt set: provisioned', async () => {
    const { service } = makeStrapi({ record: storedRow({ confirmedAt: '2026-01-01T00:00:00.000Z' }) });
    await expect(service.getStatus(42)).resolves.toMatchObject({
      provisioned:  true,
      pendingSetup: false,
    });
  });

  test('legacy row — lastUsedAt but no confirmedAt — stays provisioned', async () => {
    // A secret that has produced a valid code is in someone's authenticator by
    // definition. The fix must not invalidate accounts set up before the column.
    const { service } = makeStrapi({ record: storedRow({ lastUsedAt: '2026-01-01T00:00:00.000Z' }) });
    await expect(service.getStatus(42)).resolves.toMatchObject({ provisioned: true });
  });
});

// ---------------------------------------------------------------------------
// (B) The lockout is closed
// ---------------------------------------------------------------------------

describe('B — the login gate routes an abandoned setup back to the QR screen', () => {
  function buildHook({ status, setupPayload = { qrCodeDataUri: 'data:image/png;base64,x' } }) {
    const totpSvc = { clear: jest.fn(), require: jest.fn(), requireSetup: jest.fn() };
    const stepUp  = {
      getStatus:               async () => status,
      getOrCreateSetupPayload: jest.fn(async () => setupPayload),
      provisionSecret:         jest.fn(async () => setupPayload),
    };

    const strapi = {
      log: { warn: jest.fn(), debug: jest.fn() },
      plugin: () => ({
        service: (s) => {
          if (s === 'stepUpConfig')   return { getEnabled: async () => true };
          if (s === 'adminLoginTotp') return totpSvc;
          if (s === 'stepUp')         return stepUp;
          return null;
        },
      }),
      service: () => ({ findOne: async () => ({ roles: [{ code: 'strapi-super-admin' }] }) }),
    };

    return { hook: require('../server/hooks/admin-auth')({ strapi }), totpSvc, stepUp };
  }

  test('abandoned setup: setup is required again, no code is demanded', async () => {
    const { hook, totpSvc, stepUp } = buildHook({
      status: { provisioned: false, pendingSetup: true },
    });

    await hook._applyTotpGateForUser(42);

    expect(totpSvc.requireSetup).toHaveBeenCalled();
    expect(totpSvc.require).not.toHaveBeenCalled();

    // And the QR actually reaches the browser — requireSetup with null setupData
    // would render "QR code unavailable" and strand the user just the same.
    const [, setupData] = totpSvc.requireSetup.mock.calls[0];
    expect(setupData).toEqual({ qrCodeDataUri: 'data:image/png;base64,x' });
    expect(stepUp.getOrCreateSetupPayload).toHaveBeenCalledWith(42);
  });

  test('confirmed account: a code is demanded, no new secret is minted', async () => {
    const { hook, totpSvc, stepUp } = buildHook({
      status: { provisioned: true, pendingSetup: false },
    });

    await hook._applyTotpGateForUser(42);

    expect(totpSvc.require).toHaveBeenCalledWith(42);
    expect(totpSvc.requireSetup).not.toHaveBeenCalled();
    expect(stepUp.getOrCreateSetupPayload).not.toHaveBeenCalled();
    expect(stepUp.provisionSecret).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (C) Confirming stamps confirmedAt
// ---------------------------------------------------------------------------

describe('C — a verified code confirms the secret', () => {
  test('verifySetup stamps confirmedAt, and the account becomes provisioned', async () => {
    const { service, state } = makeStrapi();
    const { authenticator } = require('otplib');

    const { base32Secret } = await service.provisionSecret(42);
    expect(state.record.confirmedAt).toBeNull();
    await expect(service.getStatus(42)).resolves.toMatchObject({ provisioned: false });

    const result = await service.verifySetup(42, authenticator.generate(base32Secret));

    expect(result.valid).toBe(true);
    expect(state.record.confirmedAt).toEqual(expect.any(String));
    await expect(service.getStatus(42)).resolves.toMatchObject({ provisioned: true });
  });

  test('the login-gate path confirms too — it verifies through issueStepUpToken, not verifySetup', async () => {
    const { service, state } = makeStrapi();
    const { authenticator } = require('otplib');

    process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'p58-test-admin-jwt-secret';

    const { base32Secret } = await service.provisionSecret(42);
    const result = await service.issueStepUpToken(42, '127.0.0.1', authenticator.generate(base32Secret));

    expect(result.token).toEqual(expect.any(String));
    expect(state.record.confirmedAt).toEqual(expect.any(String));
  });

  test('a wrong code confirms nothing', async () => {
    const { service, state } = makeStrapi();

    await service.provisionSecret(42);
    const result = await service.verifySetup(42, '000000');

    expect(result.valid).toBe(false);
    expect(state.record.confirmedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (D) An abandoned secret is re-shown, not regenerated
// ---------------------------------------------------------------------------

describe('D — getOrCreateSetupPayload', () => {
  test('re-displays the abandoned secret, so a QR already scanned still works', async () => {
    const { service, state } = makeStrapi();

    const first = await service.provisionSecret(42);
    expect(state.created).toHaveLength(1);

    const second = await service.getOrCreateSetupPayload(42);

    expect(second.base32Secret).toBe(first.base32Secret);
    expect(second.provisioningUri).toBe(first.provisioningUri);
    expect(state.created).toHaveLength(1); // nothing new was written
  });

  test('provisions a fresh secret when there is no row', async () => {
    const { service, state } = makeStrapi({ record: null });

    const payload = await service.getOrCreateSetupPayload(42);

    expect(payload.base32Secret).toEqual(expect.any(String));
    expect(state.created).toHaveLength(1);
  });

  test('re-provisions when the stored secret cannot be decrypted', async () => {
    // A rotated ENCRYPTION_KEY or a corrupt row must not leave the user staring
    // at an error — they get a working QR instead.
    const { service, state, strapi } = makeStrapi({ record: storedRow() });

    const payload = await service.getOrCreateSetupPayload(42);

    expect(payload.base32Secret).toEqual(expect.any(String));
    expect(state.created).toHaveLength(1);
    expect(strapi.log.warn).toHaveBeenCalled();
  });

  test('a confirmed secret is replaced, never re-displayed', async () => {
    // Re-showing a live secret's QR would hand the current secret to whoever
    // reached the screen. Confirmed accounts go down the provisioning path.
    const { service, state } = makeStrapi({
      record: storedRow({ confirmedAt: '2026-01-01T00:00:00.000Z' }),
    });

    await service.getOrCreateSetupPayload(42);

    expect(state.created).toHaveLength(1);
    expect(state.created[0].confirmedAt).toBeNull();
  });
});
