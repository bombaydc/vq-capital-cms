import type { Core } from '@strapi/strapi';
import { updateCacheControl } from '../src/workers/cache-control-updater';
import { syncFlag, changedUids } from '../src/workers/sync-flag';

/**
 * Cron tasks — enabled with CRON_ENABLED=true (config/server.ts).
 *
 * cacheControlSync: after the search-indexer worker writes a JSON snapshot it
 * sets a shared flag; this task then POSTs the changed content-type UIDs to the
 * frontend revalidate webhook (CACHE_SYNC_WEBHOOK_URL + REVALIDATE_SECRET_TOKEN).
 * Without CACHE_SYNC_WEBHOOK_URL it only clears the flag.
 */
export default (_: Pick<Core.Config.Shared.ConfigParams, 'env'>) => ({
  cacheControlSync: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      await updateCacheControl({ strapi, syncFlag, changedUids });
    },
    options: {
      rule: '* * * * *',
    },
  },
});
