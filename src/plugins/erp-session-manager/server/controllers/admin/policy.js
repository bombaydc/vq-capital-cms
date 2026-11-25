'use strict';

/**
 * Policy controller — GET and PUT for the live session policy (G4).
 *
 * GET  /erp-session-manager/policy — returns current effective policy (any admin)
 * PUT  /erp-session-manager/policy — updates policy, requires step-up token (super-admin)
 *
 * The step-up gate is enforced by StepUpAuth_Middleware via the 'policy_management'
 * route group; this controller only validates the field values.
 *
 * References: Gap G4 (Policy CRUD API)
 */

const { envelope, envelopeError, setRequestId } = require('../../utils/response');

const NUMERIC_FIELDS = [
  'maxConcurrentSessions',
  'idleTimeoutMinutes',
  'absoluteTimeoutHours',
  'tokenRotationMinutes',
  'stepUpValidityMinutes',
  'alertAfterFailedAttempts',
  'businessHoursStart',
  'businessHoursEnd',
  'activityLogRetentionDays',
  'sessionRetentionDays',
  'maxSpeedKmh',
];

function validateNumericFields(fields) {
  for (const field of NUMERIC_FIELDS) {
    if (fields[field] === undefined || fields[field] === null) continue;
    const val = fields[field];
    if (!Number.isInteger(val) || val < 1) {
      return `${field} must be a positive integer (got ${val})`;
    }
  }
  return null;
}

function validateHoursFields(fields) {
  for (const field of ['businessHoursStart', 'businessHoursEnd']) {
    if (fields[field] !== undefined && fields[field] !== null) {
      if (fields[field] < 0 || fields[field] > 23) {
        return `${field} must be between 0 and 23`;
      }
    }
  }
  return null;
}

function validateBooleanFields(fields) {
  const BOOLEAN_FIELDS = ['blockOnIpChange', 'blockOnUaChange', 'impossibleTravelEnabled'];
  for (const field of BOOLEAN_FIELDS) {
    if (fields[field] !== undefined && fields[field] !== null) {
      if (typeof fields[field] !== 'boolean') {
        return `${field} must be a boolean (got ${typeof fields[field]})`;
      }
    }
  }
  return null;
}

module.exports = function createPolicyController({ strapi }) {
  return {
  /**
   * GET /erp-session-manager/policy
   * Returns the current effective session policy (DB record merged with config defaults).
   */
  async getPolicy(ctx) {
    setRequestId(ctx);
    try {
      const policyService = strapi.plugin('erp-session-manager').service('policy');
      const policy = await policyService.getPolicy();
      ctx.body = envelope(policy);
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalServerError', err.message);
    }
  },

  /**
   * PUT /erp-session-manager/policy
   * Updates the session policy. Protected by step-up token (policy_management group).
   * Super-admin only.
   */
  async updatePolicy(ctx) {
    setRequestId(ctx);

    const fields  = ctx.request.body || {};
    const adminId = ctx.state.user?.id;

    const numErr = validateNumericFields(fields);
    if (numErr) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', numErr);
      return;
    }

    const hoursErr = validateHoursFields(fields);
    if (hoursErr) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', hoursErr);
      return;
    }

    const boolErr = validateBooleanFields(fields);
    if (boolErr) {
      ctx.status = 400;
      ctx.body = envelopeError(400, 'ValidationError', boolErr);
      return;
    }

    try {
      const policyService = strapi.plugin('erp-session-manager').service('policy');
      await policyService.updatePolicy(fields, adminId);
      const updated = await policyService.getPolicy();
      ctx.body = envelope(updated);
    } catch (err) {
      ctx.status = 500;
      ctx.body = envelopeError(500, 'InternalServerError', err.message);
    }
  },
  };
};
