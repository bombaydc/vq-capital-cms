import type { Core } from '@strapi/strapi';
// JS module (allowJs): JSON snapshot + Meilisearch worker, bucket CORS bootstrap.
import searchSync from './lifecycle/search-sync';
// JS module: Public role access for the contact form + default Contact Page schema.
import publicAccess from './lifecycle/public-access';

export default {
  /**
   * Runs before the application is initialised.
   * Registers the Document Service middleware that hands admin edits to the
   * search-indexer worker (JSON snapshot in uploads/data → optional Meilisearch).
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    searchSync.register({ strapi });
  },

  /**
   * Runs before the server starts listening.
   * Starts the worker and applies the S3 / GCS bucket CORS policy when a bucket is configured.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await searchSync.bootstrap({ strapi });
    await publicAccess.bootstrap({ strapi });
  },
};
