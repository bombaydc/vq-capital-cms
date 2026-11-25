'use strict';

/**
 * StepUpService — TOTP-based step-up authentication for sensitive admin operations.
 *
 * Provides:
 *   - TOTP secret provisioning (AES-256-GCM encrypted at rest)
 *   - Step-up token issuance (short-lived IP-bound JWT with single-use JTI)
 *   - Step-up token verification (signature, expiry, IP binding, JTI uniqueness)
 *   - Rate limiting for failed TOTP attempts
 *
 * References: Req 18.1–18.3, Design §15.3
 */

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

/**
 * Derive the AES-256-GCM encryption key from ENCRYPTION_KEY env var.
 * Uses scrypt for key stretching: salt = 'erp:step-up-secret-v1', N=16384, r=8, p=1.
 * @returns {Buffer} 32-byte key
 */
function deriveEncryptionKey() {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) {
    throw new Error(
      '[erp-session-manager] ENCRYPTION_KEY environment variable is not set. ' +
      'Step-up authentication requires this variable.'
    );
  }
  return crypto.scryptSync(encKey, 'erp:step-up-secret-v1', 32);
}

/**
 * Derive the JWT signing secret for step-up tokens.
 * Uses HMAC-SHA256(ADMIN_JWT_SECRET, 'erp:step-up-token-v1').
 * @returns {Buffer}
 */
function deriveStepUpSigningSecret() {
  const adminJwtSecret = process.env.ADMIN_JWT_SECRET;
  if (!adminJwtSecret) {
    throw new Error(
      '[erp-session-manager] ADMIN_JWT_SECRET environment variable is not set. ' +
      'Step-up authentication requires this variable.'
    );
  }
  return crypto
    .createHmac('sha256', adminJwtSecret)
    .update('erp:step-up-token-v1')
    .digest();
}

/**
 * In-memory Set of consumed JTIs for single-use enforcement.
 * Entries are auto-expired after tokenTtl + 60s via setTimeout.
 * @type {Set<string>}
 */
const _usedJtis = new Set();

/**
 * In-memory rate limit counters for failed TOTP attempts.
 * Key: userId string, Value: { count, resetAt }
 * @type {Map<string, { count: number, resetAt: number }>}
 */
const _failCounters = new Map();

module.exports = ({ strapi }) => ({

  // ---------------------------------------------------------------------------
  // Secret provisioning
  // ---------------------------------------------------------------------------

  /**
   * _isConfirmed(record)
   *
   * A stored secret only counts once the user has proved their authenticator
   * actually holds it. Provisioning writes the row BEFORE the QR is displayed,
   * so a row on its own means nothing — someone who closed the tab on the QR
   * screen leaves an identical row behind.
   *
   * `lastUsedAt` is accepted alongside `confirmedAt` so secrets provisioned
   * before `confirmedAt` existed are not invalidated: a secret that has ever
   * produced a valid code is, by definition, in the user's authenticator.
   * Rows with neither are exactly the abandoned-setup rows.
   *
   * @param {{ confirmedAt?: string|null, lastUsedAt?: string|null }|null} record
   * @returns {boolean}
   */
  _isConfirmed(record) {
    return Boolean(record && (record.confirmedAt || record.lastUsedAt));
  },

  /**
   * _buildSetupPayload(userId, base32Secret)
   *
   * Builds the otpauth:// provisioning URI and its QR code for a Base32 secret.
   * Shared by first-time provisioning and by re-displaying an unconfirmed secret.
   *
   * @param {number} userId
   * @param {string} base32Secret
   * @returns {Promise<{ provisioningUri: string, base32Secret: string, qrCodeDataUri: string|null }>}
   */
  async _buildSetupPayload(userId, base32Secret) {
    // Look up the user's email for a human-readable authenticator label
    let userEmail = `user-${userId}`;
    try {
      const adminUser = await strapi.db.query('admin::user').findOne({
        where: { id: userId },
        select: ['email'],
      });
      if (adminUser?.email) {
        userEmail = adminUser.email;
      }
    } catch {
      // Non-critical — fall back to user-{id}
    }

    // Build provisioning URI
    const issuer = 'ERP Session Manager';
    const label  = encodeURIComponent(`${issuer}:${userEmail}`);
    const provisioningUri =
      `otpauth://totp/${label}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    // Generate QR code as base64 PNG data URI
    let qrCodeDataUri = null;
    try {
      const qrcode = require('qrcode');
      qrCodeDataUri = await qrcode.toDataURL(provisioningUri, { width: 200, margin: 2 });
    } catch {
      // QR generation is best-effort — user can still enter the secret manually
    }

    return { provisioningUri, base32Secret, qrCodeDataUri };
  },

  /**
   * getOrCreateSetupPayload(userId)
   *
   * Returns the QR/secret payload to show on the forced-setup screen.
   *
   * Re-displays the EXISTING secret when the stored one was never confirmed,
   * instead of minting a new one. Someone who scanned the QR and then closed
   * the tab before entering their first code keeps a working authenticator
   * entry; regenerating on every login would silently invalidate it and make
   * the second attempt fail for a reason the user cannot see.
   *
   * Falls back to a fresh secret when there is no row, or when the stored one
   * cannot be decrypted (wrong/rotated ENCRYPTION_KEY, corrupt row).
   *
   * @param {number} userId
   * @returns {Promise<{ provisioningUri: string, base32Secret: string, qrCodeDataUri: string|null }>}
   */
  async getOrCreateSetupPayload(userId) {
    const record = await this._getSecretRecord(userId);

    if (record && !this._isConfirmed(record)) {
      try {
        return await this._buildSetupPayload(userId, this._decryptSecret(record));
      } catch (err) {
        strapi.log.warn(
          `[step-up] unconfirmed secret for user ${userId} could not be decrypted, re-provisioning: ${err.message}`
        );
      }
    }

    return this.provisionSecret(userId);
  },

  /**
   * provisionSecret(userId)
   *
   * Generates a new TOTP secret, encrypts it with AES-256-GCM, and stores it
   * in the erp_step_up_secrets collection. Returns the provisioning URI and
   * Base32-encoded secret for display to the user.
   *
   * If a secret already exists for this user, it is replaced (pending re-verification).
   *
   * The new row is written UNCONFIRMED (`confirmedAt: null`). Until the user
   * enters a code from it, getStatus() reports `provisioned: false` so the
   * login gate keeps offering setup rather than demanding a code the user has
   * no way to produce.
   *
   * @param {number} userId
   * @returns {Promise<{ provisioningUri: string, base32Secret: string, qrCodeDataUri: string|null }>}
   */
  async provisionSecret(userId) {
    const { authenticator } = require('otplib');

    // Generate 20-byte (160-bit) CSPRNG secret
    const rawSecretBytes = crypto.randomBytes(20);
    const base32Secret = authenticator.generateSecret(rawSecretBytes.length);

    // Encrypt with AES-256-GCM
    const key = deriveEncryptionKey();
    const iv  = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(base32Secret, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Upsert: delete existing record if present, then create new
    try {
      const existing = await strapi
        .documents('plugin::erp-session-manager.erp-step-up-secret')
        .findFirst({ filters: { userId } });

      if (existing) {
        await strapi
          .documents('plugin::erp-session-manager.erp-step-up-secret')
          .delete({ documentId: existing.documentId });
      }
    } catch {
      // No existing record — proceed
    }

    await strapi
      .documents('plugin::erp-session-manager.erp-step-up-secret')
      .create({
        data: {
          userId,
          encryptedSecret: encrypted.toString('hex'),
          iv:              iv.toString('hex'),
          authTag:         authTag.toString('hex'),
          provisionedAt:   new Date().toISOString(),
          confirmedAt:     null,
          lastUsedAt:      null,
        },
      });

    return this._buildSetupPayload(userId, base32Secret);
  },

  /**
   * _decryptSecret(record)
   *
   * Decrypts the stored AES-256-GCM encrypted TOTP secret.
   * @param {{ encryptedSecret: string, iv: string, authTag: string }} record
   * @returns {string} Base32-encoded TOTP secret
   */
  _decryptSecret(record) {
    const key        = deriveEncryptionKey();
    const iv         = Buffer.from(record.iv, 'hex');
    const authTag    = Buffer.from(record.authTag, 'hex');
    const encrypted  = Buffer.from(record.encryptedSecret, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  },

  /**
   * _getSecretRecord(userId)
   *
   * Retrieves the stored secret record for a user.
   * Returns null if not found.
   * @param {number} userId
   * @returns {Promise<object|null>}
   */
  async _getSecretRecord(userId) {
    try {
      return await strapi
        .documents('plugin::erp-session-manager.erp-step-up-secret')
        .findFirst({ filters: { userId } });
    } catch {
      return null;
    }
  },

  // ---------------------------------------------------------------------------
  // Setup verification
  // ---------------------------------------------------------------------------

  /**
   * verifySetup(userId, totpCode)
   *
   * Validates a TOTP code against the provisioned secret to confirm setup.
   * On success: logs STEP_UP_SETUP_COMPLETE audit event.
   * On failure: returns { valid: false, reason: 'INVALID_CODE' }.
   *
   * @param {number} userId
   * @param {string} totpCode
   * @returns {Promise<{ valid: boolean, reason?: string }>}
   */
  async verifySetup(userId, totpCode) {
    const record = await this._getSecretRecord(userId);
    if (!record) {
      return { valid: false, reason: 'NOT_PROVISIONED' };
    }

    const base32Secret = this._decryptSecret(record);
    const config = strapi.config.get('plugin::erp-session-manager');
    const clockSkew = config?.stepUp?.clockSkewSeconds ?? 30;

    const { authenticator } = require('otplib');
    authenticator.options = { window: Math.ceil(clockSkew / 30) };

    const isValid = authenticator.verify({ token: totpCode, secret: base32Secret });

    if (!isValid) {
      return { valid: false, reason: 'INVALID_CODE' };
    }

    // Stamp the secret as confirmed — the code proves the authenticator holds it.
    // Until this is written the row is treated as an abandoned setup and the
    // login gate keeps showing the QR instead of asking for a code.
    if (!record.confirmedAt) {
      try {
        await strapi
          .documents('plugin::erp-session-manager.erp-step-up-secret')
          .update({
            documentId: record.documentId,
            data: { confirmedAt: new Date().toISOString() },
          });
      } catch (err) {
        strapi.log.warn(`[step-up] could not stamp confirmedAt for user ${userId}: ${err.message}`);
      }
    }

    // Log setup complete
    try {
      const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
      auditLogger.log({
        eventType: 'STEP_UP_SETUP_COMPLETE',
        userId,
        outcome:   'SUCCESS',
      });
    } catch {
      // Audit log failure must never block the response
    }

    return { valid: true };
  },

  // ---------------------------------------------------------------------------
  // Step-up token issuance
  // ---------------------------------------------------------------------------

  /**
   * issueStepUpToken(userId, clientIp, totpCode)
   *
   * Validates the TOTP code, checks rate limits, and issues a short-lived
   * IP-bound JWT step-up token with a single-use JTI.
   *
   * @param {number} userId
   * @param {string} clientIp
   * @param {string} totpCode
   * @returns {Promise<{ token: string } | { error: string, status: number }>}
   */
  async issueStepUpToken(userId, clientIp, totpCode) {
    const config = strapi.config.get('plugin::erp-session-manager');
    const stepUpConfig = config?.stepUp ?? {};
    const maxAttempts = stepUpConfig.maxAttempts ?? 5;
    const windowMs    = stepUpConfig.windowMs    ?? 900000;
    const tokenTtl    = stepUpConfig.tokenTtl    ?? 300;
    const clockSkew   = stepUpConfig.clockSkewSeconds ?? 30;

    const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');

    // Check rate limit
    const counterKey = String(userId);
    const now = Date.now();
    let counter = _failCounters.get(counterKey);

    if (counter && counter.resetAt > now && counter.count >= maxAttempts) {
      auditLogger.log({
        eventType: 'STEP_UP_RATE_LIMITED',
        userId,
        ipAddress: clientIp,
        outcome:   'FAILURE',
        metadata:  { resetAt: counter.resetAt },
      });
      return { error: 'RATE_LIMITED', status: 429, resetAt: counter.resetAt };
    }

    // Get and decrypt secret
    const record = await this._getSecretRecord(userId);
    if (!record) {
      return { error: 'NOT_PROVISIONED', status: 400 };
    }

    let base32Secret;
    try {
      base32Secret = this._decryptSecret(record);
    } catch (decryptErr) {
      // Decryption failure (corrupt/tampered secret) counts as a failed attempt
      strapi.log.warn(`[step-up] secret decryption failed for user ${userId}: ${decryptErr.message}`);
      if (!counter || counter.resetAt <= now) {
        counter = { count: 0, resetAt: now + windowMs };
      }
      counter.count += 1;
      _failCounters.set(counterKey, counter);
      const delay = counter.resetAt - now;
      setTimeout(() => {
        const c = _failCounters.get(counterKey);
        if (c && c.resetAt <= Date.now()) _failCounters.delete(counterKey);
      }, delay).unref();
      return {
        error:             'INVALID_CODE',
        status:            401,
        remainingAttempts: Math.max(0, maxAttempts - counter.count),
      };
    }

    const { authenticator } = require('otplib');
    authenticator.options = { window: Math.ceil(clockSkew / 30) };

    const isValid = authenticator.verify({ token: totpCode, secret: base32Secret });

    if (!isValid) {
      // Increment fail counter
      if (!counter || counter.resetAt <= now) {
        counter = { count: 0, resetAt: now + windowMs };
      }
      counter.count += 1;
      _failCounters.set(counterKey, counter);

      // Schedule cleanup
      const delay = counter.resetAt - now;
      setTimeout(() => {
        const c = _failCounters.get(counterKey);
        if (c && c.resetAt <= Date.now()) _failCounters.delete(counterKey);
      }, delay).unref();

      auditLogger.log({
        eventType: 'STEP_UP_FAILURE',
        userId,
        ipAddress: clientIp,
        outcome:   'FAILURE',
        metadata:  { remainingAttempts: Math.max(0, maxAttempts - counter.count) },
      });

      return {
        error:             'INVALID_CODE',
        status:            401,
        remainingAttempts: Math.max(0, maxAttempts - counter.count),
      };
    }

    // Valid code — reset fail counter
    _failCounters.delete(counterKey);

    // Update lastUsedAt, and confirm the secret if this is its first valid code
    // (the login-gate path verifies through here, not through verifySetup).
    try {
      const now = new Date().toISOString();
      await strapi
        .documents('plugin::erp-session-manager.erp-step-up-secret')
        .update({
          documentId: record.documentId,
          data: record.confirmedAt ? { lastUsedAt: now } : { lastUsedAt: now, confirmedAt: now },
        });
    } catch {
      // Non-critical — proceed
    }

    // Issue step-up JWT
    const jti    = crypto.randomUUID();
    const secret = deriveStepUpSigningSecret();

    const token = jwt.sign(
      { sub: userId, ip: clientIp, jti },
      secret,
      { expiresIn: tokenTtl }
    );

    // Schedule JTI auto-expiry (tokenTtl + 60s buffer)
    setTimeout(() => {
      _usedJtis.delete(jti);
    }, (tokenTtl + 60) * 1000).unref();

    return { token };
  },

  // ---------------------------------------------------------------------------
  // Step-up token verification
  // ---------------------------------------------------------------------------

  /**
   * verifyStepUpToken(token, clientIp)
   *
   * Verifies a step-up token: signature, expiry, IP binding, JTI uniqueness.
   * Consumes the JTI on first successful use.
   *
   * @param {string} token
   * @param {string} clientIp
   * @returns {{ valid: boolean, reason?: string, payload?: object }}
   */
  verifyStepUpToken(token, clientIp) {
    let payload;

    try {
      const secret = deriveStepUpSigningSecret();
      payload = jwt.verify(token, secret);
    } catch (err) {
      const reason = err.name === 'TokenExpiredError' ? 'expired' : 'invalid';
      return { valid: false, reason };
    }

    // IP binding check
    if (payload.ip !== clientIp) {
      try {
        const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
        auditLogger.log({
          eventType: 'STEP_UP_IP_MISMATCH',
          userId:    payload.sub,
          ipAddress: clientIp,
          outcome:   'FAILURE',
          metadata:  { tokenIp: payload.ip, requestIp: clientIp },
        });
      } catch { /* non-critical */ }
      return { valid: false, reason: 'ip_mismatch' };
    }

    // Single-use JTI check
    if (_usedJtis.has(payload.jti)) {
      try {
        const auditLogger = strapi.plugin('erp-session-manager').service('auditLogger');
        auditLogger.log({
          eventType: 'STEP_UP_TOKEN_REUSE',
          userId:    payload.sub,
          ipAddress: clientIp,
          outcome:   'FAILURE',
          metadata:  { jti: payload.jti },
        });
      } catch { /* non-critical */ }
      return { valid: false, reason: 'already_used' };
    }

    // Consume JTI
    _usedJtis.add(payload.jti);

    return { valid: true, payload };
  },

  // ---------------------------------------------------------------------------
  // Status & management
  // ---------------------------------------------------------------------------

  /**
   * getStatus(userId)
   *
   * Returns provisioning status for a user.
   *
   * `provisioned` means USABLE — a confirmed secret the user can produce codes
   * from. It used to mean "a row exists", which is not the same thing and is
   * what locked people out: provisionSecret() writes the row before the QR is
   * ever shown, so abandoning the setup screen left a row behind and the next
   * login saw `provisioned: true` and demanded a code for a secret that had
   * never reached an authenticator app. `pendingSetup` reports that state.
   *
   * @param {number} userId
   * @returns {Promise<{ provisioned: boolean, pendingSetup: boolean, lastUsedAt: string|null, confirmedAt: string|null }>}
   */
  async getStatus(userId) {
    const record = await this._getSecretRecord(userId);
    if (!record) {
      return { provisioned: false, pendingSetup: false, lastUsedAt: null, confirmedAt: null };
    }

    const confirmed = this._isConfirmed(record);
    return {
      provisioned:  confirmed,
      pendingSetup: !confirmed,
      lastUsedAt:   record.lastUsedAt  || null,
      confirmedAt:  record.confirmedAt || null,
    };
  },

  /**
   * regenerateSecret(userId, totpCode)
   *
   * Verifies the current TOTP code before generating a new secret.
   * Prevents unauthorized secret regeneration.
   *
   * @param {number} userId
   * @param {string} totpCode
   * @returns {Promise<{ provisioningUri: string, base32Secret: string } | { error: string }>}
   */
  async regenerateSecret(userId, totpCode) {
    // Must verify current code first
    const verifyResult = await this.verifySetup(userId, totpCode);
    if (!verifyResult.valid) {
      return { error: verifyResult.reason || 'INVALID_CODE' };
    }

    // Generate new secret (replaces existing)
    return this.provisionSecret(userId);
  },
});
