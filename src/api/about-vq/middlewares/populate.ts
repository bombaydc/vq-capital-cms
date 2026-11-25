import type { Core } from '@strapi/strapi';

const populate = {
  milestones: true,
};

// Returns the milestones without a populate query, replacing any populate sent by the client
const middleware = (): Core.MiddlewareHandler => async (ctx, next) => {
  ctx.query = { ...ctx.query, populate };
  await next();
};

export default middleware;
