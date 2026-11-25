import { factories } from '@strapi/strapi';

const publishedOnly = { middlewares: ['global::published-only'] };

export default factories.createCoreRouter('api::leader.leader', {
  config: {
    find: publishedOnly,
    findOne: publishedOnly,
  },
});
