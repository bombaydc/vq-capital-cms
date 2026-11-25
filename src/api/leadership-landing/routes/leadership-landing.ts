import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::leadership-landing.leadership-landing', {
  config: {
    find: {
      middlewares: ['global::published-only', 'api::leadership-landing.populate'],
    },
  },
});
