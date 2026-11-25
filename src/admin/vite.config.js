'use strict';

// Custom Vite configuration for the Strapi admin panel.
//
// Purpose: ensure @vitejs/plugin-react-swc's React Fast Refresh preamble
// is always available when plugin admin components are loaded in dev mode.
//
// The preamble check (window.__vite_plugin_react_preamble_installed__)
// fails when react/jsx-runtime is resolved as a fresh module rather than
// the pre-bundled singleton. Explicit optimizeDeps.include forces Vite to
// pre-bundle it so every plugin chunk shares the same module instance.
//
// See: https://docs.strapi.io/dev-docs/admin-customization

const { mergeConfig } = require('vite');

module.exports = (config) => {
  return mergeConfig(config, {
    optimizeDeps: {
      // Force pre-bundle the JSX runtime so all chunks (including plugin
      // admin chunks) resolve to the same singleton — required for React
      // Fast Refresh preamble to be present in every module scope.
      include: [
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom/client',
      ],
    },

    resolve: {
      // Deduplicate React to prevent "Invalid hook call" warnings and
      // preamble check failures caused by multiple React instances.
      dedupe: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
      ],
    },
    // Hostnames allowed to reach the Vite dev server (admin panel in develop
    // mode). Comma-separated in ALLOWHOST, e.g. ALLOWHOST=cms.example.com,uat-cms.example.com
    server: {
      allowedHosts: [
        'localhost',
        ...String(process.env.ALLOWHOST || '')
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
      ],
    },
  });
};
