/**
 * erp-session-manager — Admin panel entry point.
 *
 * Registers the "ERP Session Manager" navigation section with three pages:
 *   - Sessions    (Req 7A.1)
 *   - Audit Logs  (Req 7B)
 *   - Settings    (Req 7C)
 *
 * Uses Strapi 5 admin APIs.
 * Design §11.5
 *
 * Menu visibility: shown to all authenticated admin users.
 * Access control is enforced at two layers:
 *   1. App.jsx — checks the user's role client-side before rendering
 *   2. Server routes — all admin routes require is-super-admin policy
 *
 * Using permissions: [] here because the custom permission
 * `plugin::erp-session-manager.read` is not registered server-side,
 * which would cause Strapi to hide the menu for everyone including
 * Super Admins. Role enforcement happens in App.jsx instead.
 */

// @ts-ignore — Shield exists in @strapi/icons v2.2.0 ESM bundle but is missing from its .d.ts declarations
import { Shield } from '@strapi/icons';
import { PLUGIN_ID } from './pluginId.js';

export default {
  register(app) {
    // Register the plugin so Strapi knows about it
    app.registerPlugin({
      id: PLUGIN_ID,
      name: 'ERP Session Manager',
    });

    // permissions: [] means "show to all authenticated admin users".
    // The App component performs its own Super Admin role check before rendering.
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}`,
      icon: Shield,
      intlLabel: {
        id: `${PLUGIN_ID}.plugin.name`,
        defaultMessage: 'ERP Session Manager',
      },
      Component: async () => {
        const { default: App } = await import('./App.jsx');
        return App;
      },
      permissions: [],
    });
  },

  bootstrap() {},

  async registerTrads({ locales }) {
    // Load translation files if they exist; fall back to empty object
    const importedTrads = await Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./translations/${locale}.json`);
          return { data, locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
    return importedTrads;
  },
};
