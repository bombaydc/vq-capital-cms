import type { Core } from '@strapi/strapi';
import { buildPopulate } from '../../../utils/deep-populate';

// Returns the whole page in one request, replacing any populate sent by the client
const middleware =
  (_config: unknown, { strapi }: { strapi: Core.Strapi }): Core.MiddlewareHandler =>
  async (ctx, next) => {
    ctx.query = {
      ...ctx.query,
      populate: buildPopulate(strapi, 'api::leadership-landing.leadership-landing'),
    };
    await next();
  };

export default middleware;
