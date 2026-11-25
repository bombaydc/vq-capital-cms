/**
 * erp-session-manager — Admin panel re-export (ESM)
 *
 * Strapi 5 resolves the admin entry via the package.json exports map:
 *   "./strapi-admin" → "./admin/src/index.js"
 *
 * This file re-exports admin/src/index.js for any tooling that
 * resolves admin/index.js directly.
 */

export { default } from './src/index.js';
