import type { Core, UID } from '@strapi/strapi';

type Populate = Record<string, unknown>;

/**
 * Builds a populate object from a schema, so new fields and dynamic zone blocks
 * are returned without code changes.
 *
 * Components are followed to any depth. Media and relations to `api::` content
 * types are returned one level deep. Other relations (admin users, plugins) are skipped.
 */
export const buildPopulate = (strapi: Core.Strapi, uid: UID.Schema): Populate => {
  const populate: Populate = {};

  const nested = (component: UID.Component) => {
    const children = buildPopulate(strapi, component);
    return Object.keys(children).length > 0 ? { populate: children } : true;
  };

  for (const [name, attribute] of Object.entries(strapi.getModel(uid).attributes)) {
    if (attribute.type === 'component') {
      populate[name] = nested(attribute.component);
    } else if (attribute.type === 'dynamiczone') {
      populate[name] = {
        on: Object.fromEntries(attribute.components.map((component: UID.Component) => [component, nested(component)])),
      };
    } else if (attribute.type === 'media') {
      populate[name] = true;
    } else if (attribute.type === 'relation' && name !== 'localizations') {
      if ('target' in attribute && String(attribute.target).startsWith('api::')) populate[name] = true;
    }
  }

  return populate;
};
