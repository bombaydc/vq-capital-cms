import type { Core } from '@strapi/strapi';

// Strapi returns drafts to anyone with read access who sends ?status=draft.
// This limits requests to published content, except for those made with an API token (e.g. previews).
const middleware = (): Core.MiddlewareHandler => async (ctx, next) => {
  if (ctx.state.auth?.strategy?.name !== 'api-token') {
    ctx.query = { ...ctx.query, status: 'published' };
  }
  await next();
};

export default middleware;
