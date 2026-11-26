'use strict';

/**
 * Seed script for `api::common.common` (Single Type — Header & Footer menus).
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-common.js            # Create & publish Common if empty
 *   node scripts/seed-common.js --force    # Overwrite/update & publish Common
 *   node scripts/seed-common.js --export   # Also export public/uploads/data/common.json
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');
const EXPORT_JSON = process.argv.includes('--export');

function buildCommonData() {
  return {
    head_script: null,
    body_script: null,
    header_menu: [
      {
        name: 'Home',
        link: '/',
        is_external: false,
        is_downloadable: false,
        items: [],
      },
      {
        name: 'Investment philosophy',
        link: '/investment-philosophy',
        is_external: false,
        is_downloadable: false,
        items: [],
      },
      {
        name: 'The firm',
        link: null,
        is_external: false,
        is_downloadable: false,
        items: [
          {
            name: 'About VQ Capital Partners',
            label: null,
            link: '/about-vq',
            is_external: false,
            is_downloadable: false,
          },
          {
            name: 'Leadership',
            label: null,
            link: '/leadership',
            is_external: false,
            is_downloadable: false,
          },
          {
            name: 'News & events',
            label: null,
            link: '/in-the-news',
            is_external: false,
            is_downloadable: false,
          },
        ],
      },
      {
        name: 'Investment Vehicles',
        link: null,
        is_external: false,
        is_downloadable: false,
        items: [
          {
            name: 'Public Markets',
            label: null,
            link: '/public-markets',
            is_external: false,
            is_downloadable: false,
          },
          {
            name: 'Private Equity',
            label: null,
            link: '/private-equity',
            is_external: false,
            is_downloadable: false,
          },
        ],
      },
      {
        name: 'Insights',
        link: '/insights',
        is_external: false,
        is_downloadable: false,
        items: [],
      },
      {
        name: 'Contact',
        link: '/contact',
        is_external: false,
        is_downloadable: false,
        items: [],
      },
    ],
    footer_menu: {
      name: '© 2026 VQ Capital Partners. All rights reserved.',
      message:
        'Independent investment thinking across Indian public markets and Private Equity.',
      location: 'Mumbai, India',
      contact_link: {
        buttonText: 'Contact',
        type: 'Internal',
        buttonType: 'Primary',
        buttonLink: '/contact',
      },
      menus: [
        {
          name: 'The firm',
          link: null,
          is_external: false,
          is_downloadable: false,
          items: [
            {
              name: 'About VQ Capital Partners',
              label: null,
              link: '/about-vq',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Leadership',
              label: null,
              link: '/leadership',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Careers',
              label: null,
              link: '/careers',
              is_external: false,
              is_downloadable: false,
            },
          ],
        },
        {
          name: 'Explore',
          link: null,
          is_external: false,
          is_downloadable: false,
          items: [
            {
              name: 'Investment philosophy',
              label: null,
              link: '/investment-philosophy',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Investment vehicles',
              label: null,
              link: '/investment-vehicles',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Insights',
              label: null,
              link: '/insights',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'News & Events',
              label: null,
              link: '/in-the-news',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Contact',
              label: null,
              link: '/contact',
              is_external: false,
              is_downloadable: false,
            },
          ],
        },
        {
          name: 'Legal',
          link: null,
          is_external: false,
          is_downloadable: false,
          items: [
            {
              name: 'Regulatory information',
              label: null,
              link: '/regulatory-information',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Disclaimer',
              label: null,
              link: '/disclaimer',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Privacy policy',
              label: null,
              link: '/privacy-policy',
              is_external: false,
              is_downloadable: false,
            },
            {
              name: 'Terms of use',
              label: null,
              link: '/terms-of-use',
              is_external: false,
              is_downloadable: false,
            },
          ],
        },
      ],
    },
  };
}

async function run() {
  process.chdir(PROJECT_ROOT);
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist/config/database.js'))) {
    throw new Error('dist/ not built. Run `npm run build` first.');
  }

  let app;
  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    const commonData = buildCommonData();
    const existing = await app.documents('api::common.common').findFirst({ status: 'published' });

    if (existing && !FORCE) {
      console.log(
        `[seed-common] Common already published (documentId=${existing.documentId}). Pass --force to overwrite.`
      );
    } else if (existing && FORCE) {
      const updated = await app.documents('api::common.common').update({
        documentId: existing.documentId,
        data: commonData,
        status: 'published',
      });
      console.log(`[seed-common] Updated & published Common (documentId=${updated.documentId})`);
    } else {
      const created = await app.documents('api::common.common').create({
        data: commonData,
        status: 'published',
      });
      console.log(`[seed-common] Created & published Common (documentId=${created.documentId})`);
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const res = await syncJSON('api::common.common');
      console.log('[seed-common] Export common.json:', res.status, res.message);
    }
  } finally {
    if (app) {
      await app.destroy();
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-common] Failed:', err);
    process.exit(1);
  });
