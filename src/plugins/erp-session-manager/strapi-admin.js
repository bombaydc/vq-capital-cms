/**
 * erp-session-manager — Admin panel entry point (ESM)
 *
 * Strapi 5 resolves the admin entry via the package.json exports map:
 *   "./strapi-admin" → "./admin/src/index.js"
 *
 * This file is kept as a fallback for tooling that reads strapi-admin.js
 * directly. It re-exports the admin/src/index.js module.
 */

export { default } from './admin/src/index.js';
