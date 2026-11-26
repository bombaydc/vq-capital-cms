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
module.exports = {
  home: {
    apiPath:
      'api/home?' +
      [
        'populate[seo][populate][metaImage][fields][0]=url',
        'populate[seo][populate][metaImage][fields][1]=alternativeText',
        'populate[seo][populate][metaSocial][populate][image][fields][0]=url',
        'populate[seo][populate][metaSocial][populate][image][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][stat_items][populate]=*',
        'populate[content][on][common.insight-section][populate][cards][populate][image][fields][0]=url',
        'populate[content][on][common.insight-section][populate][cards][populate][image][fields][1]=alternativeText',
        'populate[content][on][common.insight-section][populate][cards][populate][buttons][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.insight-section][populate][cards][populate][buttons][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.insight-section][populate][cards][populate][buttons][populate][media][fields][0]=url',
        'populate[content][on][common.insight-section][populate][cards][populate][buttons][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.hero-banner][populate][banners][populate][desktop_image][fields][0]=url',
        'populate[content][on][common.hero-banner][populate][banners][populate][desktop_image][fields][1]=alternativeText',
        'populate[content][on][common.hero-banner][populate][banners][populate][mobile_image][fields][0]=url',
        'populate[content][on][common.hero-banner][populate][banners][populate][mobile_image][fields][1]=alternativeText',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][1]=alternativeText',
      ].join('&'),
    isCollection: false,
    jsonFile: 'home.json',
  },
  leadership: {
    apiPath:
      'api/leadership?' +
      [
        'populate[seo][populate][metaImage][fields][0]=url',
        'populate[seo][populate][metaImage][fields][1]=alternativeText',
        'populate[seo][populate][metaSocial][populate][image][fields][0]=url',
        'populate[seo][populate][metaSocial][populate][image][fields][1]=alternativeText',
        'populate[content][on][common.dynamic-section][populate]=*',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][1]=alternativeText',
      ].join('&'),
    isCollection: false,
    jsonFile: 'leadership.json',
  },
  leader: {
    apiPath:
      'api/leaders?' +
      [
        'populate[buttons][populate][buttonIcon][fields][0]=url',
        'populate[buttons][populate][buttonIcon][fields][1]=alternativeText',
        'populate[buttons][populate][media][fields][0]=url',
        'populate[buttons][populate][media][fields][1]=alternativeText',
        'populate[card_image][fields][0]=url',
        'populate[card_image][fields][1]=alternativeText',
        'populate[profile_image][fields][0]=url',
        'populate[profile_image][fields][1]=alternativeText',
        'populate[seo][populate][metaImage][fields][0]=url',
        'populate[seo][populate][metaImage][fields][1]=alternativeText',
        'populate[seo][populate][metaSocial][populate][image][fields][0]=url',
        'populate[seo][populate][metaSocial][populate][image][fields][1]=alternativeText',
      ].join('&'),
    isCollection: true,
    jsonFile: 'leaders.json',
  },
  about: {
    apiPath:
      'api/about?' +
      [
        'populate[seo][populate][metaImage][fields][0]=url',
        'populate[seo][populate][metaImage][fields][1]=alternativeText',
        'populate[seo][populate][metaSocial][populate][image][fields][0]=url',
        'populate[seo][populate][metaSocial][populate][image][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][stat_items][populate]=*',
        'populate[content][on][common.timeline-section][populate][items][populate]=*',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][1]=alternativeText',
      ].join('&'),
    isCollection: false,
    jsonFile: 'about.json',
  },
  common: {
    apiPath:
      'api/common?' +
      [
        'populate[header_menu][populate][items][populate]=*',
        'populate[footer_menu][populate][image][fields][0]=url',
        'populate[footer_menu][populate][image][fields][1]=alternativeText',
        'populate[footer_menu][populate][contact_link][populate][buttonIcon][fields][0]=url',
        'populate[footer_menu][populate][contact_link][populate][buttonIcon][fields][1]=alternativeText',
        'populate[footer_menu][populate][contact_link][populate][media][fields][0]=url',
        'populate[footer_menu][populate][contact_link][populate][media][fields][1]=alternativeText',
        'populate[footer_menu][populate][menus][populate][items][populate]=*',
      ].join('&'),
    isCollection: false,
    jsonFile: 'common.json',
  },
  career: {
    apiPath:
      'api/career?' +
      [
        'populate[seo][populate][metaImage][fields][0]=url',
        'populate[seo][populate][metaImage][fields][1]=alternativeText',
        'populate[seo][populate][metaSocial][populate][image][fields][0]=url',
        'populate[seo][populate][metaSocial][populate][image][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][stat_items][populate]=*',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][1]=alternativeText',
      ].join('&'),
    isCollection: false,
    jsonFile: 'career.json',
  },
  'contact-page': {
    apiPath:
      'api/contact-page?' +
      [
        'populate[seo][populate][metaImage][fields][0]=url',
        'populate[seo][populate][metaImage][fields][1]=alternativeText',
        'populate[seo][populate][metaSocial][populate][image][fields][0]=url',
        'populate[seo][populate][metaSocial][populate][image][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][grid_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.main-section][populate][list_items][populate][button][populate][media][fields][1]=alternativeText',
        'populate[content][on][common.main-section][populate][stat_items][populate]=*',
        'populate[content][on][common.form-section][populate]=*',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][buttonIcon][fields][1]=alternativeText',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][0]=url',
        'populate[content][on][common.bottom-link][populate][button][populate][media][fields][1]=alternativeText',
      ].join('&'),
    isCollection: false,
    jsonFile: 'contact-page.json',
  },
};
