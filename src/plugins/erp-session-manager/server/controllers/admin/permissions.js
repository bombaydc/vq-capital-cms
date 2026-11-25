'use strict';

/**
 * Permissions controller — returns the custom RBAC actions registered by this
 * plugin (G16/G17).  Useful for building dynamic permission checks in the UI.
 *
 * GET /erp-session-manager/permissions
 *
 * References: Gap G16, G17
 */

const { envelope, setRequestId } = require('../../utils/response');

const PLUGIN_PERMISSIONS = [
  { uid: 'plugin::erp-session-manager.sessions.read',   displayName: 'View Sessions',      section: 'plugins' },
  { uid: 'plugin::erp-session-manager.sessions.revoke', displayName: 'Revoke Sessions',    section: 'plugins' },
  { uid: 'plugin::erp-session-manager.audit-logs.read', displayName: 'View Audit Logs',    section: 'plugins' },
  { uid: 'plugin::erp-session-manager.policy.update',   displayName: 'Edit Security Policy', section: 'plugins' },
];

module.exports = ({ strapi: _strapi }) => ({
  async listPermissions(ctx) {
    setRequestId(ctx);
    ctx.body = envelope(PLUGIN_PERMISSIONS);
  },
});
