'use strict';

module.exports = (plugin) => {
  // VAPT #13: add isAuthenticatedAdmin to /policies and /routes admin routes.
  // These routes had no protection at all — any unauthenticated caller could
  // enumerate all registered policy names and route paths.
  if (plugin.routes?.admin?.routes) {
    plugin.routes.admin.routes = plugin.routes.admin.routes.map((route) => {
      const isTarget =
        route.method === 'GET' &&
        (route.path === '/policies' || route.path === '/routes');
      if (!isTarget) return route;
      return {
        ...route,
        config: {
          ...(route.config || {}),
          policies: [...(route.config?.policies || []), 'admin::isAuthenticatedAdmin'],
        },
      };
    });
  }
  return plugin;
};
