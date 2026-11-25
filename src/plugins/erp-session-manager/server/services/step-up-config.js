'use strict';

/**
 * StepUpConfigService — persists the global TOTP step-up enabled/disabled flag
 * in Strapi's built-in plugin store (strapi_core_store_settings table) so that
 * the setting survives server restarts.
 *
 * Uses a module-level in-memory cache to avoid a DB round-trip on every request.
 * The cache is invalidated whenever setEnabled() is called.
 * On first access after a fresh start it reads from the store, falling back to
 * the static value in config/plugins.js.
 */

let _cached = null; // null = not yet loaded; bool = cached value

module.exports = ({ strapi }) => ({

  /**
   * Returns true if TOTP step-up is currently enabled.
   * Reads from strapi.store on first call, uses cache thereafter.
   */
  async getEnabled() {
    if (_cached !== null) return _cached;

    const pluginStore = strapi.store({
      pluginName: 'erp-session-manager',
      type: 'plugin',
    });

    const stored = await pluginStore.get({ key: 'stepup_enabled' });

    if (stored === null || stored === undefined) {
      // Nothing in DB yet — fall back to static config
      const staticConfig = strapi.config.get('plugin::erp-session-manager');
      _cached = staticConfig?.stepUp?.enabled !== false;
    } else {
      _cached = Boolean(stored);
    }

    return _cached;
  },

  /**
   * Sets the global TOTP step-up enabled flag.
   * Persists to DB and updates the in-memory cache immediately.
   * @param {boolean} value
   */
  async setEnabled(value) {
    const pluginStore = strapi.store({
      pluginName: 'erp-session-manager',
      type: 'plugin',
    });

    await pluginStore.set({ key: 'stepup_enabled', value: Boolean(value) });
    _cached = Boolean(value);

    strapi.log.info(
      `[erp-session-manager] Step-up authentication ${value ? 'enabled' : 'disabled'} globally.`
    );
  },
});
