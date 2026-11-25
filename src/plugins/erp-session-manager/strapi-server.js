'use strict';

/**
 * erp-session-manager — Strapi server entry point
 *
 * Exports the three Strapi plugin lifecycle hooks:
 *   register  — called before the application is bootstrapped; used to add
 *               services, controllers, routes, middlewares, policies, and
 *               content types to the Strapi container.
 *   bootstrap — called after all plugins are registered; used to initialise
 *               the session store, load GeoLite2, register users-permissions
 *               hooks, and schedule cron jobs.
 *   destroy   — called when Strapi shuts down; used to close Redis connections
 *               and flush pending writes.
 */

const server = require('./server');

module.exports = server;
