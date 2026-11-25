'use strict';

/**
 * Bootstrap defaults that every fresh database / environment needs for the
 * public contact form to work. Both steps are idempotent and never undo
 * changes made in the admin panel.
 *
 * 1. Public role: grants ONLY the two endpoints the frontend form calls
 *      POST /api/csrf-token               (csrf-token.generateToken)
 *      POST /api/contact-form-submission  (form-submission.contactFormSubmission)
 *    Everything else stays closed (Strapi default). Revoking one of these in
 *    Settings → Users & Permissions → Public is respected until the permission
 *    row is re-created, so set PUBLIC_FORM_AUTOGRANT=false to stop re-granting.
 *
 * 2. Contact Page: seeds a generic form_schema (name, email, country code,
 *    mobile, message) only when the single type has no schema yet. Edit the
 *    JSON in Content Manager → Contact Page to change the VQ field list.
 */

const PUBLIC_ACTIONS = [
  'api::csrf-token.csrf-token.generateToken',
  'api::form-submission.form-submission.contactFormSubmission',
];

const DEFAULT_CONTACT_SCHEMA = {
  name: {
    name: 'name', type: 'text', title: 'Full Name', default: null, position: 1,
    required: true, minLength: 2, maxLength: 100, placeholder: '',
    validation: { pattern: [{ value: "^[a-zA-Z\\s\\-\\.']+$", message: 'Name must contain only letters, spaces, hyphens, apostrophes and periods' }] },
  },
  email: {
    name: 'email', type: 'email', title: 'Email address', default: null, position: 2,
    required: true, placeholder: '',
  },
  countrycode: {
    name: 'countrycode', type: 'country_select', title: 'Country Code', default: '+91',
    position: 3, required: true, multiple: false, searchable: true, placeholder: '',
  },
  mobile: {
    name: 'mobile', type: 'tel', title: 'Phone Number', default: null, position: 4,
    required: true, placeholder: '', defaultCountry: '91', defaultMobileLength: 10,
  },
  message: {
    name: 'message', type: 'textarea', title: 'Message', default: null, position: 5,
    required: false, maxLength: 1000, placeholder: '',
  },
};

async function grantPublicFormAccess(strapi) {
  if (String(process.env.PUBLIC_FORM_AUTOGRANT ?? 'true').toLowerCase() === 'false') return;

  const role = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });
  if (!role) return;

  const permQuery = strapi.db.query('plugin::users-permissions.permission');
  const added = [];
  for (const action of PUBLIC_ACTIONS) {
    const exists = await permQuery.findOne({ where: { action, role: role.id } });
    if (!exists) {
      await permQuery.create({ data: { action, role: role.id } });
      added.push(action);
    }
  }
  if (added.length) strapi.log.info(`[public-access] Public role granted: ${added.join(', ')}`);
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
  strapi.log.info('[public-access] Contact Page form_schema seeded with the default VQ fields.');
}

module.exports = {
  PUBLIC_ACTIONS,
  DEFAULT_CONTACT_SCHEMA,
  async bootstrap({ strapi }) {
    try {
      await grantPublicFormAccess(strapi);
      await seedContactPage(strapi);
    } catch (err) {
      strapi.log.error(`[public-access] bootstrap failed: ${err.message}`);
    }
  },
};
