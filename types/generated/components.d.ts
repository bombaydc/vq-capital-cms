import type { Schema, Struct } from '@strapi/strapi';

export interface AboutVqMilestone extends Struct.ComponentSchema {
  collectionName: 'components_about_vq_milestones';
  info: {
    displayName: 'Milestone';
    icon: 'calendar';
  };
  attributes: {
    description: Schema.Attribute.Text & Schema.Attribute.Required;
    year: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface DynamicSectionLeadership extends Struct.ComponentSchema {
  collectionName: 'components_dynamic_section_leaderships';
  info: {
    displayName: 'Leadership';
    icon: 'apps';
  };
  attributes: {
    category: Schema.Attribute.Enumeration<
      ['Founders', 'Board of Directors', 'Lead Management Team']
    > &
      Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    type: Schema.Attribute.Enumeration<['leader-list', 'leader-grid']> &
      Schema.Attribute.Required;
  };
}

export interface SharedButtonLink extends Struct.ComponentSchema {
  collectionName: 'components_shared_button_links';
  info: {
    displayName: 'Button link';
    icon: 'link';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    openInNewTab: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    displayName: 'SEO';
    icon: 'search';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 170;
      }>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 70;
      }>;
    noIndex: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    ogImage: Schema.Attribute.Media<'images'>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'about-vq.milestone': AboutVqMilestone;
      'dynamic-section.leadership': DynamicSectionLeadership;
      'shared.button-link': SharedButtonLink;
      'shared.seo': SharedSeo;
    }
  }
}
