'use strict';

/**
 * P55 — Activity log stores request bodies without leaking or corrupting them
 *
 * Requested: record the body of POST/PUT/PATCH/DELETE requests in the activity
 * log, excluding binary uploads; store secrets encrypted rather than in the
 * clear; show PII only partially, enough to identify a record; and do all of it
 * in the LOG ONLY — the request itself must not be modified.
 *
 * That last constraint is the dangerous one. ctx.request.body is the object the
 * route handler goes on to use, so a transformation applied in place would mean
 * an encrypted password is both logged AND submitted — every login would break.
 * §A pins it.
 *
 * Covers:
 *   (A) The request body is never mutated
 *   (B) Secrets are encrypted, never stored in the clear, and round-trip
 *   (C) PII is partially masked — identifiable, not readable
 *   (D) Ordinary fields survive untouched
 *   (E) Hostile payloads (cycles, depth, buffers) cannot break the logger
 */

const fc = require('fast-check');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-for-p55-activity-body';

const {
  transformBody, encryptValue, decryptValue, maskEmail, isPiiKey, shouldMaskPii, isSecretKey,
} = require('../server/utils/activity-body');

// ---------------------------------------------------------------------------
// A. The request is never modified
// ---------------------------------------------------------------------------

describe('A — transformBody never mutates the request body', () => {
  test('the login body is byte-identical after transformation', () => {
    const body = { email: 'admin@example.com', password: 'S3cret!', rememberMe: true };
    const before = JSON.stringify(body);

    const stored = transformBody(body);

    expect(JSON.stringify(body)).toBe(before);
    expect(body.password).toBe('S3cret!');        // the handler still sees the real one
    expect(stored.password).not.toBe('S3cret!');  // the log does not
  });

  test('nested objects and arrays are copied, not aliased', () => {
    const nested = { password: 'p' };
    const body   = { user: nested, tags: ['a', 'b'] };

    const stored = transformBody(body);

    expect(body.user).toBe(nested);            // same reference as before
    expect(stored.user).not.toBe(nested);      // a fresh object
    expect(stored.tags).not.toBe(body.tags);
    expect(nested.password).toBe('p');
  });

  test('property: any body survives transformation unchanged', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom('email', 'password', 'name', 'mobile', 'title', 'count', 'token'),
          fc.oneof(fc.string(), fc.integer(), fc.boolean())
        ),
        (body) => {
          const before = JSON.stringify(body);
          transformBody(body);
          expect(JSON.stringify(body)).toBe(before);
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// B. Secrets are encrypted
// ---------------------------------------------------------------------------

describe('B — secrets are encrypted, never stored in the clear', () => {
  test.each([
    ['password'], ['currentPassword'], ['newPassword'], ['confirmPassword'],
    ['token'], ['refreshToken'], ['jwt'], ['totpCode'], ['captchaAnswer'],
    ['apiKey'], ['api_key'], ['clientSecret'], ['authorization'], ['privateKey'],
  ])('%s is encrypted', (key) => {
    const secret = 'the-actual-secret-value';
    const stored = transformBody({ [key]: secret });

    expect(isSecretKey(key)).toBe(true);
    expect(stored[key]).toMatch(/^enc:v1:/);
    expect(stored[key]).not.toContain(secret);
  });

  test('the whole serialised body contains no plaintext secret', () => {
    const body = {
      email: 'admin@example.com',
      password: 'Sup3rS3cret!',
      nested: { apiKey: 'ak_live_1234567890' },
    };
    const text = JSON.stringify(transformBody(body));

    expect(text).not.toContain('Sup3rS3cret!');
    expect(text).not.toContain('ak_live_1234567890');
  });

  test('encryption round-trips, so the value is recoverable with the key', () => {
    const stored = transformBody({ password: 'round-trip-me' });
    expect(decryptValue(stored.password)).toBe('round-trip-me');
  });

  test('the same secret encrypts differently each time (random IV)', () => {
    const a = encryptValue('same-value');
    const b = encryptValue('same-value');
    expect(a).not.toBe(b);
    expect(decryptValue(a)).toBe('same-value');
    expect(decryptValue(b)).toBe('same-value');
  });

  test('property: no secret value ever appears in the output', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 6 }), (secret) => {
        const text = JSON.stringify(transformBody({ password: secret, note: 'ok' }));
        expect(text).not.toContain(secret);
      })
    );
  });

  test('a missing ENCRYPTION_KEY fails closed, not open', () => {
    const saved = process.env.ENCRYPTION_KEY;
    jest.resetModules();
    delete process.env.ENCRYPTION_KEY;
    const fresh = require('../server/utils/activity-body');
    try {
      const stored = fresh.transformBody({ password: 'must-not-leak' });
      expect(stored.password).toBe('[ENCRYPT_FAILED]');
      expect(JSON.stringify(stored)).not.toContain('must-not-leak');
    } finally {
      process.env.ENCRYPTION_KEY = saved;
      jest.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// C. PII is partially visible
// ---------------------------------------------------------------------------

describe('C — PII is masked but still identifiable', () => {
  test('email keeps a prefix and the TLD', () => {
    const masked = maskEmail('rajesh.kumar@gmail.com');
    expect(masked.startsWith('ra')).toBe(true);
    expect(masked.endsWith('.com')).toBe(true);
    expect(masked).not.toContain('jesh.kumar');
    expect(masked).not.toContain('gmail');
  });

  test('phone keeps the last 4 digits', () => {
    const stored = transformBody({ mobile: '9876543210' });
    expect(stored.mobile.endsWith('3210')).toBe(true);
    expect(stored.mobile).not.toContain('987654');
  });

  test('name keeps the first 2 characters', () => {
    const stored = transformBody({ firstname: 'Rajesh' });
    expect(stored.firstname.startsWith('Ra')).toBe(true);
    expect(stored.firstname).not.toContain('jesh');
  });

  test.each([
    ['email'], ['userEmail'], ['e-mail'], ['mobile'], ['phone'], ['whatsapp'],
    ['firstname'], ['lastname'], ['address'], ['pincode'], ['dob'], ['aadhaar'],
  ])('%s is treated as PII', (key) => {
    expect(isPiiKey(key)).toBe(true);
  });

  test.each([
    ['fileName'], ['field_name'], ['collectionName'], ['singularName'],
    ['pluralName'], ['displayName'], ['modelName'], ['roleName'], ['schemaName'],
  ])('%s is structural, not PII', (key) => {
    expect(isPiiKey(key)).toBe(false);
  });

  test('property: a masked email never contains the full local part', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => /^[a-z0-9]+$/i.test(s)),
        (local) => {
          const masked = maskEmail(`${local}@example.com`);
          expect(masked).not.toContain(local);
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// D. Ordinary fields untouched
// ---------------------------------------------------------------------------

describe('D — non-sensitive fields are stored as-is', () => {
  test('a content payload survives intact', () => {
    const body = { title: 'Hello world', slug: 'hello-world', views: 42, published: true };
    expect(transformBody(body)).toEqual(body);
  });

  test('nested structures are walked, not flattened', () => {
    const body = { seo: { metaTitle: 'T', nested: { deep: 'value' } }, list: [1, 2, 3] };
    expect(transformBody(body)).toEqual(body);
  });

  test('null and undefined pass through', () => {
    const stored = transformBody({ a: null, b: undefined, password: null });
    expect(stored.a).toBeNull();
    expect(stored.b).toBeUndefined();
    expect(stored.password).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E. Hostile payloads
// ---------------------------------------------------------------------------

describe('E — hostile payloads cannot break the logger', () => {
  test('a circular reference does not hang or throw', () => {
    const body = { name: 'x' };
    body.self = body;
    const stored = transformBody(body);
    expect(JSON.stringify(stored)).toContain('[CIRCULAR]');
  });

  test('deep nesting is truncated instead of blowing the stack', () => {
    let deep = { end: true };
    for (let i = 0; i < 200; i++) deep = { nested: deep };
    const stored = transformBody(deep);
    expect(JSON.stringify(stored)).toContain('[TRUNCATED_DEPTH]');
  });

  test('buffers are summarised, not serialised', () => {
    const stored = transformBody({ file: Buffer.alloc(1024) });
    expect(stored.file).toBe('[BUFFER:1024]');
  });

  test('long arrays are capped', () => {
    const stored = transformBody({ ids: Array.from({ length: 5000 }, (_, i) => i) });
    expect(stored.ids.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// F. Content Manager paths are exempt from PII masking
// ---------------------------------------------------------------------------

describe('F — /content-manager/* bodies are stored unmasked', () => {
  // The API path, NOT the browser URL. The admin SPA is at
  // /admin/content-manager/…, but Strapi mounts the plugin's admin routes at
  // /content-manager/… with no /admin prefix, so that is what Koa sees and what
  // the exemption has to match. Matching the browser URL is what made this
  // exemption a no-op and left content entries masked.
  const CM = '/content-manager/collection-types/api::article.article';

  test.each([
    [CM, false],
    ['/content-manager/single-types/api::global.global', false],
    ['/content-manager/single-types/api::about-page.about-page/actions/publish', false],
    ['/content-manager/collection-types/api::product.product/xjrb8h/actions/publish', false],
    ['/content-manager/uid/generate', false],
    // Schema definitions are structure, not identity.
    ['/content-type-builder/update-schema', false],
    ['/content-type-builder/content-types', false],
    ['/content-type-builder/components', false],
    // The SPA URL never reaches the server; it must not be what we key on.
    ['/admin/content-manager/collection-types/api::article.article', true],
    ['/admin/content-type-builder/update-schema', true],
    ['/content-type-builder-foo', true],
    ['/admin/users', true],
    ['/admin/users/me', true],
    ['/api/lead-contact', true],
    ['/erp-session-manager/policy', true],
    ['/content-manager-foo', true],   // prefix must not be enough
    ['', true],
    [undefined, true],
  ])('shouldMaskPii(%s) → %s', (path, expected) => {
    expect(shouldMaskPii(path)).toBe(expected);
  });

  test('a content entry keeps its name/title/author fields readable', () => {
    const body = {
      title: 'Interview with Rajesh Kumar',
      name: 'Rajesh Kumar',
      author: { name: 'Priya Sharma', email: 'priya@example.com' },
      address: '221B Baker Street',
    };
    const stored = transformBody(body, { maskPii: shouldMaskPii(CM) });
    expect(stored).toEqual(body);
  });

  test('the same body IS masked outside content-manager', () => {
    const body = { name: 'Rajesh Kumar', email: 'rajesh@example.com' };
    const stored = transformBody(body, { maskPii: shouldMaskPii('/admin/users') });
    expect(stored.name).not.toBe('Rajesh Kumar');
    expect(stored.email).not.toBe('rajesh@example.com');
  });

  test('a schema payload keeps its attribute names readable', () => {
    // The shape content-type-builder actually posts to update-schema.
    const body = {
      contentType: {
        displayName: 'Article',
        singularName: 'article',
        attributes: {
          name:        { type: 'string' },
          authorEmail: { type: 'email' },
          address:     { type: 'text' },
        },
      },
      components: [{ category: 'common', displayName: 'Banner', attributes: { name: { type: 'string' } } }],
    };
    const stored = transformBody(body, { maskPii: shouldMaskPii('/content-type-builder/update-schema') });
    expect(stored).toEqual(body);
  });

  test('secrets are STILL encrypted on an exempt path', () => {
    // The exemption relaxes PII masking only — it must never become the one
    // route a credential can be written to the log in the clear.
    const stored = transformBody(
      { title: 'ok', password: 'must-not-leak', apiKey: 'ak_live_9' },
      { maskPii: shouldMaskPii(CM) }
    );
    expect(stored.title).toBe('ok');
    expect(stored.password).toMatch(/^enc:v1:/);
    expect(stored.apiKey).toMatch(/^enc:v1:/);
    expect(JSON.stringify(stored)).not.toContain('must-not-leak');
  });

  test('maskPii defaults to on when no options are passed', () => {
    expect(transformBody({ email: 'a.person@example.com' }).email).not.toBe('a.person@example.com');
  });
});
