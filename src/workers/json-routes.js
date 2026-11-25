'use strict';

/**
 * JSON snapshot routes — PROJECT-SPECIFIC.
 *
 * When an admin creates / updates / publishes / unpublishes / deletes an entry,
 * the search-indexer worker looks the content type up here, calls the Strapi
 * REST API with `apiPath` (STRAPI_API_BASE + STRAPI_API_TOKEN), and writes the
 * response to `uploads/data/<jsonFile>` (local) or `data/<jsonFile>` in the
 * configured bucket. On publish/unpublish the same data is pushed to
 * Meilisearch when MEILI_ENABLE is set (index name = jsonFile without .json).
 *
 * Key = the content type's singular name (the part after "api::<name>.").
 * Content types with no entry here are skipped.
 *
 * Example:
 *   home: {
 *     apiPath: 'api/home?populate[seo][populate]=*',
 *     isCollection: false,     // single type → one request
 *     jsonFile: 'home.json',
 *   },
 *   article: {
 *     apiPath: 'api/articles?populate[cover][fields][0]=url',
 *     isCollection: true,      // collection → all pages fetched (25/page)
 *     jsonFile: 'articles.json',
 *   },
 */
module.exports = {};
