'use strict';

/**
 * Bootstrap security & defaults for the Contact form.
 *
 * 1. Public role: REVOKES public access to `/api/csrf-token` and
 *    `/api/contact-form-submission` so all form requests require a valid
 *    Strapi API Bearer Token (`Authorization: Bearer <token>`).
 *
 * 2. Contact Page: seeds `form_schema` only when the single type has no
 *    schema yet (safe fallback for fresh databases).
 */

const REVOKED_PUBLIC_ACTIONS = [
  'api::csrf-token.csrf-token.generateToken',
  'api::form-submission.form-submission.contactFormSubmission',
];

const DEFAULT_CONTACT_SCHEMA = {
  name: {
    name: 'name',
    type: 'text',
    title: 'Name',
    default: null,
    position: 1,
    required: true,
    minLength: 2,
    maxLength: 100,
    placeholder: '',
    validation: {
      pattern: [
        {
          value: "^[a-zA-Z\\s\\-\\.']+$",
          message: 'Name must contain only letters, spaces, hyphens, apostrophes and periods',
        },
      ],
    },
  },
  countrycode: {
    name: 'countrycode',
    type: 'country_select',
    title: 'Country Code',
    default: '+91',
    position: 2,
    required: true,
    multiple: false,
    searchable: true,
    placeholder: '',
  },
  mobile: {
    name: 'mobile',
    type: 'tel',
    title: 'Mobile Number',
    default: null,
    position: 3,
    required: true,
    placeholder: '',
    defaultCountry: '91',
    defaultMobileLength: 10,
  },
  email: {
    name: 'email',
    type: 'email',
    title: 'Email',
    default: null,
    position: 4,
    required: true,
    placeholder: '',
  },
  country: {
    name: 'country',
    type: 'text',
    title: 'Country',
    default: null,
    position: 5,
    required: true,
    minLength: 2,
    maxLength: 100,
    placeholder: '',
  },
  nature: {
    name: 'nature',
    type: 'select',
    title: 'Nature of enquiry',
    default: null,
    position: 6,
    required: true,
    multiple: false,
    searchable: false,
    otherOption: false,
    placeholder: 'Select primary topic',
    enum: [
      { label: 'Investment Banking (M&A, ECM, Private Equity)', value: 'Investment Banking (M&A, ECM, Private Equity)' },
      { label: 'Wealth Management / Private Wealth', value: 'Wealth Management / Private Wealth' },
      { label: 'Credit Solutions / Structured Finance', value: 'Credit Solutions / Structured Finance' },
      { label: 'Asset Management', value: 'Asset Management' },
      { label: 'Careers & Recruitment', value: 'Careers & Recruitment' },
      { label: 'Media & Press Inquiries', value: 'Media & Press Inquiries' },
      { label: 'General Inquiry', value: 'General Inquiry' },
    ],
  },
  details: {
    name: 'details',
    type: 'textarea',
    title: 'Details',
    default: null,
    position: 7,
    required: true,
    maxLength: 2000,
    placeholder: '',
  },
};

async function revokePublicFormAccess(strapi) {
  const role = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });
  if (!role) return;

  const permQuery = strapi.db.query('plugin::users-permissions.permission');
  const removed = [];
  for (const action of REVOKED_PUBLIC_ACTIONS) {
    const existing = await permQuery.findMany({ where: { action, role: role.id } });
    for (const row of existing) {
      await permQuery.delete({ where: { id: row.id } });
      removed.push(action);
    }
  }
  if (removed.length) {
    strapi.log.info(`[public-access] Revoked Public role permissions (Bearer token required): ${removed.join(', ')}`);
  }
}

async function seedContactPage(strapi) {
  const uid = 'api::contact-page.contact-page';
  const page = await strapi.documents(uid).findFirst();
  const hasSchema = page?.form_schema && Object.keys(page.form_schema).length > 0;
  if (hasSchema) return;

  if (page) {
    await strapi.documents(uid).update({ documentId: page.documentId, data: { form_schema: DEFAULT_CONTACT_SCHEMA } });
  } else {
    await strapi.documents(uid).create({ data: { form_schema: DEFAULT_CONTACT_SCHEMA, emails: '' } });
  }
  strapi.log.info('[public-access] Contact Page form_schema seeded with default VQ fields.');
}

module.exports = {
  REVOKED_PUBLIC_ACTIONS,
  DEFAULT_CONTACT_SCHEMA,
  async bootstrap({ strapi }) {
    try {
      await revokePublicFormAccess(strapi);
      await seedContactPage(strapi);
    } catch (err) {
      strapi.log.error(`[public-access] bootstrap failed: ${err.message}`);
    }
  },
};
