import type { Schema, Struct } from '@strapi/strapi';

export interface CommonBannerItem extends Struct.ComponentSchema {
  collectionName: 'components_common_banner_items';
  info: {
    description: '';
    displayName: 'Banner Item';
  };
  attributes: {
    desktop_image: Schema.Attribute.Media<'images'>;
    mobile_image: Schema.Attribute.Media<'images'>;
  };
}

export interface CommonBottomLink extends Struct.ComponentSchema {
  collectionName: 'components_common_bottom_links';
  info: {
    description: '';
    displayName: 'Bottom Link';
  };
  attributes: {
    button: Schema.Attribute.Component<'common.button', false>;
    name: Schema.Attribute.String & Schema.Attribute.DefaultTo<'continue'>;
  };
}

export interface CommonButton extends Struct.ComponentSchema {
  collectionName: 'components_common_buttons';
  info: {
    description: '';
    displayName: 'Button';
  };
  attributes: {
    buttonIcon: Schema.Attribute.Media<'images'>;
    buttonLink: Schema.Attribute.Text;
    buttonText: Schema.Attribute.String;
    buttonType: Schema.Attribute.Enumeration<
      ['Primary', 'Secondary', 'Tertiary']
    >;
    media: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    referral: Schema.Attribute.Enumeration<
      ['nofollow', 'noreferrer', 'noopener']
    >;
    type: Schema.Attribute.Enumeration<
      [
        'Internal',
        'External',
        'Popup',
        'Download',
        'Email',
        'Mobile',
        'Email-copy',
      ]
    >;
  };
}

export interface CommonDynamicSection extends Struct.ComponentSchema {
  collectionName: 'components_common_dynamic_sections';
  info: {
    description: '';
    displayName: 'Dynamic Section';
  };
  attributes: {
    name: Schema.Attribute.String;
    type: Schema.Attribute.Enumeration<['leader-list']>;
  };
}

export interface CommonFaq extends Struct.ComponentSchema {
  collectionName: 'components_common_faqs';
  info: {
    description: '';
    displayName: 'FAQ';
  };
  attributes: {
    answer: Schema.Attribute.RichText &
      Schema.Attribute.CustomField<
        'plugin::ckeditor5.CKEditor',
        {
          preset: 'defaultHtml';
        }
      >;
    button: Schema.Attribute.Component<'common.button', false>;
    question: Schema.Attribute.String;
  };
}

export interface CommonFaqSection extends Struct.ComponentSchema {
  collectionName: 'components_common_faq_sections';
  info: {
    description: '';
    displayName: 'FAQ Section';
  };
  attributes: {
    description: Schema.Attribute.Text;
    faqs: Schema.Attribute.Component<'common.faq', true>;
    label: Schema.Attribute.String;
    name: Schema.Attribute.String;
  };
}

export interface CommonFooter extends Struct.ComponentSchema {
  collectionName: 'components_common_footers';
  info: {
    description: '';
    displayName: 'Footer';
  };
  attributes: {
    contact_link: Schema.Attribute.Component<'common.button', false>;
    image: Schema.Attribute.Media<'images'>;
    location: Schema.Attribute.String;
    menus: Schema.Attribute.Component<'menu.item', true>;
    message: Schema.Attribute.Text;
    name: Schema.Attribute.String;
  };
}

export interface CommonFormSection extends Struct.ComponentSchema {
  collectionName: 'components_common_form_sections';
  info: {
    description: 'Inline contact/enquiry form section header, fieldset legend, and submit label';
    displayName: 'Form Section';
  };
  attributes: {
    description: Schema.Attribute.Text;
    fieldset_legend: Schema.Attribute.String;
    label: Schema.Attribute.String;
    name: Schema.Attribute.String;
    submit_label: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'Submit'>;
  };
}

export interface CommonHeroBanner extends Struct.ComponentSchema {
  collectionName: 'components_common_hero_banners';
  info: {
    description: '';
    displayName: 'Hero Banner';
  };
  attributes: {
    banners: Schema.Attribute.Component<'common.banner-item', true>;
    description: Schema.Attribute.Text;
    name: Schema.Attribute.String;
  };
}

export interface CommonInsightCard extends Struct.ComponentSchema {
  collectionName: 'components_common_insight_cards';
  info: {
    description: '';
    displayName: 'Insight Card';
  };
  attributes: {
    buttons: Schema.Attribute.Component<'common.button', true>;
    description: Schema.Attribute.Text;
    image: Schema.Attribute.Media<'images'>;
    label: Schema.Attribute.String;
    label_value: Schema.Attribute.String;
    name: Schema.Attribute.String;
  };
}

export interface CommonInsightSection extends Struct.ComponentSchema {
  collectionName: 'components_common_insight_sections';
  info: {
    description: '';
    displayName: 'Insight Section';
  };
  attributes: {
    cards: Schema.Attribute.Component<'common.insight-card', true>;
    name: Schema.Attribute.String;
  };
}

export interface CommonMainSection extends Struct.ComponentSchema {
  collectionName: 'components_common_main_sections';
  info: {
    description: '';
    displayName: 'Main Section';
  };
  attributes: {
    button: Schema.Attribute.Component<'common.button', false>;
    description: Schema.Attribute.Text;
    grid_items: Schema.Attribute.Component<'common.section-item', true>;
    label: Schema.Attribute.String;
    list_items: Schema.Attribute.Component<'common.section-item', true>;
    name: Schema.Attribute.String;
    stat_items: Schema.Attribute.Component<'common.stat-item', true>;
  };
}

export interface CommonMediaSection extends Struct.ComponentSchema {
  collectionName: 'components_common_media_sections';
  info: {
    description: '';
    displayName: 'Media Section';
  };
  attributes: {
    button: Schema.Attribute.Component<'common.button', false>;
    description: Schema.Attribute.Text;
    desktop_image: Schema.Attribute.Media<'images'>;
    items: Schema.Attribute.Component<'common.section-item', true>;
    label: Schema.Attribute.String;
    mobile_image: Schema.Attribute.Media<'images'>;
    name: Schema.Attribute.String;
  };
}

export interface CommonQuoteSection extends Struct.ComponentSchema {
  collectionName: 'components_common_quote_sections';
  info: {
    description: '';
    displayName: 'Quote Section';
  };
  attributes: {
    author: Schema.Attribute.String;
    desktop_image: Schema.Attribute.Media<'images'>;
    mobile_image: Schema.Attribute.Media<'images'>;
    quote: Schema.Attribute.Text;
  };
}

export interface CommonRichTextItem extends Struct.ComponentSchema {
  collectionName: 'components_common_rich_text_items';
  info: {
    description: '';
    displayName: 'Rich Text Item';
  };
  attributes: {
    button: Schema.Attribute.Component<'common.button', false>;
    description: Schema.Attribute.RichText &
      Schema.Attribute.CustomField<
        'plugin::ckeditor5.CKEditor',
        {
          preset: 'defaultHtml';
        }
      >;
    name: Schema.Attribute.String;
  };
}

export interface CommonRichTextSection extends Struct.ComponentSchema {
  collectionName: 'components_common_rich_text_sections';
  info: {
    description: '';
    displayName: 'Rich Text Section';
  };
  attributes: {
    button: Schema.Attribute.Component<'common.button', false>;
    description: Schema.Attribute.RichText &
      Schema.Attribute.CustomField<
        'plugin::ckeditor5.CKEditor',
        {
          preset: 'defaultHtml';
        }
      >;
    grid_items: Schema.Attribute.Component<'common.section-item', true>;
    label: Schema.Attribute.String;
    name: Schema.Attribute.String;
    rich_items: Schema.Attribute.Component<'common.rich-text-item', true>;
  };
}

export interface CommonSectionItem extends Struct.ComponentSchema {
  collectionName: 'components_common_section_items';
  info: {
    description: '';
    displayName: 'Section Item';
  };
  attributes: {
    button: Schema.Attribute.Component<'common.button', false>;
    description: Schema.Attribute.Text;
    name: Schema.Attribute.String;
  };
}

export interface CommonStatItem extends Struct.ComponentSchema {
  collectionName: 'components_common_stat_items';
  info: {
    description: '';
    displayName: 'Stat Item';
  };
  attributes: {
    description: Schema.Attribute.Text;
    name: Schema.Attribute.String;
    stat: Schema.Attribute.String;
  };
}

export interface CommonStepsSection extends Struct.ComponentSchema {
  collectionName: 'components_common_steps_sections';
  info: {
    description: '';
    displayName: 'Steps Section';
  };
  attributes: {
    description: Schema.Attribute.Text;
    items: Schema.Attribute.Component<'common.section-item', true>;
    label: Schema.Attribute.String;
    name: Schema.Attribute.String;
  };
}

export interface CommonTimelineItem extends Struct.ComponentSchema {
  collectionName: 'components_common_timeline_items';
  info: {
    description: '';
    displayName: 'Timeline Item';
  };
  attributes: {
    description: Schema.Attribute.Text;
    year: Schema.Attribute.String;
  };
}

export interface CommonTimelineSection extends Struct.ComponentSchema {
  collectionName: 'components_common_timeline_sections';
  info: {
    description: '';
    displayName: 'Timeline Section';
  };
  attributes: {
    description: Schema.Attribute.Text;
    items: Schema.Attribute.Component<'common.timeline-item', true>;
    label: Schema.Attribute.String;
    name: Schema.Attribute.String;
  };
}

export interface MenuItem extends Struct.ComponentSchema {
  collectionName: 'components_menu_items';
  info: {
    displayName: 'item';
  };
  attributes: {
    is_downloadable: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    is_external: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    items: Schema.Attribute.Component<'menu.sub-item', true>;
    link: Schema.Attribute.String;
    name: Schema.Attribute.String;
  };
}

export interface MenuSubItem extends Struct.ComponentSchema {
  collectionName: 'components_menu_sub_items';
  info: {
    displayName: 'sub-item';
  };
  attributes: {
    is_downloadable: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    is_external: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    label: Schema.Attribute.String;
    link: Schema.Attribute.String;
    name: Schema.Attribute.String;
  };
}

export interface SharedMetaSocial extends Struct.ComponentSchema {
  collectionName: 'components_shared_meta_socials';
  info: {
    description: '';
    displayName: 'metaSocial';
    icon: 'project-diagram';
  };
  attributes: {
    description: Schema.Attribute.String;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
    socialNetwork: Schema.Attribute.Enumeration<['Facebook', 'Twitter']> &
      Schema.Attribute.Required;
    title: Schema.Attribute.String;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'seo';
    icon: 'search';
  };
  attributes: {
    body_script: Schema.Attribute.Text;
    canonicalURL: Schema.Attribute.String;
    head_script: Schema.Attribute.Text;
    keywords: Schema.Attribute.Text;
    metaDescription: Schema.Attribute.Text;
    metaImage: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
    metaRobots: Schema.Attribute.String;
    metaSocial: Schema.Attribute.Component<'shared.meta-social', true>;
    metaTitle: Schema.Attribute.String;
    metaViewport: Schema.Attribute.String;
    structuredData: Schema.Attribute.JSON;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'common.banner-item': CommonBannerItem;
      'common.bottom-link': CommonBottomLink;
      'common.button': CommonButton;
      'common.dynamic-section': CommonDynamicSection;
      'common.faq': CommonFaq;
      'common.faq-section': CommonFaqSection;
      'common.footer': CommonFooter;
      'common.form-section': CommonFormSection;
      'common.hero-banner': CommonHeroBanner;
      'common.insight-card': CommonInsightCard;
      'common.insight-section': CommonInsightSection;
      'common.main-section': CommonMainSection;
      'common.media-section': CommonMediaSection;
      'common.quote-section': CommonQuoteSection;
      'common.rich-text-item': CommonRichTextItem;
      'common.rich-text-section': CommonRichTextSection;
      'common.section-item': CommonSectionItem;
      'common.stat-item': CommonStatItem;
      'common.steps-section': CommonStepsSection;
      'common.timeline-item': CommonTimelineItem;
      'common.timeline-section': CommonTimelineSection;
      'menu.item': MenuItem;
      'menu.sub-item': MenuSubItem;
      'shared.meta-social': SharedMetaSocial;
      'shared.seo': SharedSeo;
    }
  }
}
