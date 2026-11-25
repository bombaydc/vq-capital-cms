import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::about-vq.about-vq', {
  config: {
    find: {
      middlewares: ['api::about-vq.populate'],
    },
  },
});
