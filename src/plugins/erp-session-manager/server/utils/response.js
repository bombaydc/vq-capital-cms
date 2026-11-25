'use strict';

const { randomUUID } = require('crypto');

/**
 * API_Envelope builder — constructs the standard { data, meta, error } response
 * shape used by all plugin endpoints (Req 16.16, Design §6.1).
 *
 * Also injects the X-Request-Id header (UUID v4) into every response (Req 16.18).
 */

module.exports = {
  /**
   * envelope(data, meta)
   * Builds a successful API response envelope.
   * @param {*} data
   * @param {object} [meta]
   * @returns {{ data: *, meta: object, error: null }}
   */
  envelope(data, meta = {}) {
    return { data, meta, error: null };
  },

  /**
   * envelopeError(status, name, message, details)
   * Builds an error API response envelope.
   * @param {number} status   — HTTP status code
   * @param {string} name     — error class name, e.g. 'ValidationError'
   * @param {string} message  — human-readable message
   * @param {object} [details]
   * @returns {{ data: null, meta: {}, error: object }}
   */
  envelopeError(status, name, message, details = {}) {
    return { data: null, meta: {}, error: { status, name, message, details } };
  },

  /**
   * setRequestId(ctx)
   * Injects a UUID v4 X-Request-Id header into the Koa context response.
   * @param {import('koa').Context} ctx
   * @returns {string} the generated request ID
   */
  setRequestId(ctx) {
    const requestId = randomUUID();
    ctx.set('X-Request-Id', requestId);
    return requestId;
  },
};
