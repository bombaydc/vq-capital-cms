'use strict';

/**
 * Seed script for `api::contact-page.contact-page` (Single Type) + its SEO media.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-contact.js            # Create & publish Contact Page if empty
 *   node scripts/seed-contact.js --force    # Overwrite/update & publish Contact Page
 *   node scripts/seed-contact.js --export   # Also export public/uploads/data/contact-page.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');
const EXPORT_JSON = process.argv.includes('--export');

const SOCIAL_IMAGE_URL = 'https://wondrous-sawine-0270e5.netlify.app/vq-social-preview.png';
const SOCIAL_IMAGE_NAME = 'vq-social-preview.png';

const CONTACT_FORM_SCHEMA = require('../src/api/form-submission/form-schema/inquire.json');

async function ensureSocialMedia(app, tempDir) {
  const existing = await app.db.query('plugin::upload.file').findOne({
    where: { name: SOCIAL_IMAGE_NAME },
  });
  if (existing) return existing.id;

  try {
    const res = await fetch(SOCIAL_IMAGE_URL);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(tempDir, SOCIAL_IMAGE_NAME);
    fs.writeFileSync(dest, buf);
    const [uploaded] = await app.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: SOCIAL_IMAGE_NAME, alternativeText: SOCIAL_IMAGE_NAME } },
      files: {
        filepath: dest,
        originalFilename: SOCIAL_IMAGE_NAME,
        mimetype: 'image/png',
        size: buf.length,
      },
    });
    return uploaded.id;
  } catch (err) {
    console.warn('[seed-contact] Social image upload skipped:', err.message);
    return null;
  }
}

function buildContactData(socialId) {
  return {
    label: 'Begin a conversation',
    name: 'Capital deserves a direct conversation.',
    description:
      'For public markets, private equity, media enquiries or careers, use the form or contact the relevant team directly.',
    emails: '',
    form_schema: CONTACT_FORM_SCHEMA,
    seo: {
      metaTitle: 'VQ Capital Partners — Independent investment thinking',
      metaDescription:
        'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
      metaRobots: 'noindex, nofollow',
      metaViewport: 'width=device-width, initial-scale=1',
      ...(socialId ? { metaImage: socialId } : {}),
      metaSocial: [
        {
          socialNetwork: 'Facebook',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(socialId ? { image: socialId } : {}),
        },
        {
          socialNetwork: 'Twitter',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(socialId ? { image: socialId } : {}),
        },
      ],
    },
    content: [
      {
        __component: 'common.main-section',
        label: 'Contact directory',
        name: 'Choose the right conversation.',
        description:
          'A concise note about the mandate, horizon or question in front of you helps us direct the conversation well.',
        list_items: [
          {
            name: 'Public markets',
            button: {
              buttonText: 'investors@valuequest.com',
              type: 'Email-copy',
              buttonType: 'Primary',
              buttonLink: 'mailto:investors@valuequest.com',
            },
          },
          {
            name: 'Private equity',
            button: {
              buttonText: 'private@valuequest.com',
              type: 'Email-copy',
              buttonType: 'Primary',
              buttonLink: 'mailto:private@valuequest.com',
            },
          },
          {
            name: 'Press & media',
            button: {
              buttonText: 'press@valuequest.com',
              type: 'Email-copy',
              buttonType: 'Primary',
              buttonLink: 'mailto:press@valuequest.com',
            },
          },
          {
            name: 'Careers',
            button: {
              buttonText: 'careers@valuequest.com',
              type: 'Email-copy',
              buttonType: 'Primary',
              buttonLink: 'mailto:careers@valuequest.com',
            },
          },
          {
            name: 'Telephone',
            button: {
              buttonText: '+91 22 6939 4444',
              type: 'Mobile',
              buttonType: 'Primary',
              buttonLink: 'tel:+912269394444',
            },
          },
          {
            name: 'Mumbai office',
            description:
              'Kohinoor Square Business Park, B-4101/4102/4105, 41st Floor, N. C. Kelkar Marg, Dadar West, Shivaji Park, Mumbai, Maharashtra 400028, India. Visits by appointment.',
          },
        ],
      },
      {
        __component: 'common.form-section',
        label: 'Enquiry form',
        name: 'Begin a conversation.',
        description: 'Share a few details and we’ll help direct your enquiry to the right team.',
        fieldset_legend: 'How can we help you?',
        submit_label: 'Submit',
      },
      {
        __component: 'common.bottom-link',
        name: 'continue',
        button: {
          buttonText: 'Home',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/',
        },
      },
    ],
  };
}

async function run() {
  process.chdir(PROJECT_ROOT);
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist/config/database.js'))) {
    throw new Error('dist/ not built. Run `npm run build` first.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-contact-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    const socialId = await ensureSocialMedia(app, tempDir);
    const contactData = buildContactData(socialId);

    const existing = await app.documents('api::contact-page.contact-page').findFirst({ status: 'published' });
    const draft = existing ? null : await app.documents('api::contact-page.contact-page').findFirst();

    if (existing && !FORCE) {
      console.log(
        `[seed-contact] Contact Page already published (documentId=${existing.documentId}). Pass --force to overwrite.`
      );
    } else if (existing && FORCE) {
      const updated = await app.documents('api::contact-page.contact-page').update({
        documentId: existing.documentId,
        data: {
          ...contactData,
          ...(existing.emails ? { emails: existing.emails } : {}),
        },
        status: 'published',
      });
      console.log(`[seed-contact] Updated & published Contact Page (documentId=${updated.documentId})`);
    } else if (draft) {
      const updated = await app.documents('api::contact-page.contact-page').update({
        documentId: draft.documentId,
        data: {
          ...contactData,
          ...(draft.emails ? { emails: draft.emails } : {}),
        },
        status: 'published',
      });
      console.log(`[seed-contact] Updated draft & published Contact Page (documentId=${updated.documentId})`);
    } else {
      const created = await app.documents('api::contact-page.contact-page').create({
        data: contactData,
        status: 'published',
      });
      console.log(`[seed-contact] Created & published Contact Page (documentId=${created.documentId})`);
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const res = await syncJSON('api::contact-page.contact-page');
      console.log('[seed-contact] Export contact-page.json:', res.status, res.message);
    }
  } finally {
    if (app) {
      await app.destroy();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-contact] Failed:', err);
    process.exit(1);
  });
