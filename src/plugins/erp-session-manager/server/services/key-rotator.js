'use strict';

/**
 * KeyRotator — manages multi-key JWT signing for zero-downtime key rotation.
 *
 * The first key in tokens.signingKeys is the active signing key.
 * Subsequent keys are accepted for verification only (Req 13.1).
 *
 * Design §5.6:
 *   sign(payload)           → signs with signingKeys[0], includes kid:0 in header
 *   verify(token)           → tries each key in order; returns { payload, keyIndex }
 *   shouldReissue(keyIndex) → true when keyIndex > 0
 *
 * References: Req 13.1–13.6, Design §5.6
 */

const jwt = require('jsonwebtoken');

module.exports = ({ strapi }) => ({
  /**
   * _getSigningKeys()
   * Returns the configured signing keys array.
   * @returns {string[]}
   */
  _getSigningKeys() {
    const config = strapi.config.get('plugin::erp-session-manager');
    const keys = config && config.tokens && Array.isArray(config.tokens.signingKeys)
      ? config.tokens.signingKeys
      : [];
    return keys;
  },

  /**
   * _getAccessTokenTtl()
   * Returns the configured access token TTL in seconds.
   * @returns {number}
   */
  _getAccessTokenTtl() {
    const config = strapi.config.get('plugin::erp-session-manager');
    return (config && config.tokens && typeof config.tokens.accessTokenTtl === 'number')
      ? config.tokens.accessTokenTtl
      : 900;
  },

  /**
   * sign(payload)
   * Signs the payload with signingKeys[0] and includes `kid: 0` in the JWT header.
   * @param {object} payload — JWT claims
   * @returns {string} signed JWT
   */
  sign(payload) {
    const keys = this._getSigningKeys();
    if (!keys || keys.length === 0) {
      throw new Error('erp-session-manager: No signing keys configured. Set tokens.signingKeys in config/plugins.js.');
    }

    const ttl = this._getAccessTokenTtl();

    return jwt.sign(payload, keys[0], {
      expiresIn: ttl,
      header: { alg: 'HS256', typ: 'JWT', kid: '0' },
    });
  },

  /**
   * verify(token)
   * Tries each key in signingKeys[] in order until one succeeds.
   * Returns { payload, keyIndex } on first success.
   * Throws if all keys fail (Req 13.4).
   * @param {string} token
   * @returns {{ payload: object, keyIndex: number }}
   */
  verify(token) {
    const keys = this._getSigningKeys();
    if (!keys || keys.length === 0) {
      const err = new Error('erp-session-manager: No signing keys configured.');
      err.status = 401;
      throw err;
    }

    let lastError;
    for (let i = 0; i < keys.length; i++) {
      try {
        const payload = jwt.verify(token, keys[i]);
        return { payload, keyIndex: i };
      } catch (err) {
        lastError = err;
      }
    }

    // All keys failed (Req 13.4)
    const authErr = new Error('Invalid or expired token.');
    authErr.status = 401;
    authErr.cause = lastError;
    throw authErr;
  },

  /**
   * shouldReissue(keyIndex)
   * Returns true when the token was signed with a non-primary key,
   * indicating it should be transparently re-signed on the next refresh (Req 13.5).
   * @param {number} keyIndex
   * @returns {boolean}
   */
  shouldReissue(keyIndex) {
    return keyIndex > 0;
  },
});
