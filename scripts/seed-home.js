'use strict';

/**
 * Seed script for `api::home.home` (Single Type) + its Media Library assets.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-home.js            # Upload missing media & create Home if empty
 *   node scripts/seed-home.js --force    # Upload missing media & overwrite/publish Home
 *   node scripts/seed-home.js --export   # Also trigger JSON export (requires running Strapi + STRAPI_API_TOKEN)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');
const EXPORT_JSON = process.argv.includes('--export');

const IMAGES = [
  {
    key: 'skyline',
    url: 'https://vqcapitalpartners.vercel.app/moodboard/home-skyline-dark.webp',
    name: 'home-skyline-dark.webp',
    mime: 'image/webp',
  },
  {
    key: 'arch',
    url: 'https://vqcapitalpartners.vercel.app/moodboard/home-classical-architecture.webp',
    name: 'home-classical-architecture.webp',
    mime: 'image/webp',
  },
  {
    key: 'insight',
    url: 'https://vqcapitalpartners.vercel.app/vq-insight-patience-v2.png',
    name: 'vq-insight-patience-v2.png',
    mime: 'image/png',
  },
  {
    key: 'press',
    url: 'https://vqcapitalpartners.vercel.app/vq-press-note-fundraise-portrait.png',
    name: 'vq-press-note-fundraise-portrait.png',
    mime: 'image/png',
  },
  {
    key: 'social',
    url: 'https://wondrous-sawine-0270e5.netlify.app/vq-social-preview.png',
    name: 'vq-social-preview.png',
    mime: 'image/png',
  },
];

async function downloadImages(tempDir) {
  const downloaded = {};
  for (const img of IMAGES) {
    const dest = path.join(tempDir, img.name);
    try {
      const res = await fetch(img.url);
      if (!res.ok) {
        console.warn(`[seed-home] Failed to download ${img.url}: HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      downloaded[img.key] = { ...img, filepath: dest, size: buf.length };
      console.log(`[seed-home] Downloaded ${img.name} (${buf.length} bytes)`);
    } catch (err) {
      console.warn(`[seed-home] Error downloading ${img.url}: ${err.message}`);
    }
  }
  return downloaded;
}

function buildHomeData(uploadedIds) {
  return {
    name: 'Home',
    seo: {
      metaTitle: 'VQ Capital Partners — Independent investment thinking',
      metaDescription:
        'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
      metaRobots: 'noindex, nofollow',
      metaViewport: 'width=device-width, initial-scale=1',
      ...(uploadedIds.social ? { metaImage: uploadedIds.social } : {}),
      metaSocial: [
        {
          socialNetwork: 'Facebook',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(uploadedIds.social ? { image: uploadedIds.social } : {}),
        },
        {
          socialNetwork: 'Twitter',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(uploadedIds.social ? { image: uploadedIds.social } : {}),
        },
      ],
    },
    content: [
      {
        __component: 'common.hero-banner',
        name: 'Where change becomes investible.',
        description:
          'VQ Capital Partners formerly known as ValueQuest, is a conviction-driven, research-led investment manager across Indian public markets and Private Equity.',
        banners: [
          ...(uploadedIds.skyline
            ? [{ desktop_image: uploadedIds.skyline, mobile_image: uploadedIds.skyline }]
            : []),
          ...(uploadedIds.arch
            ? [{ desktop_image: uploadedIds.arch, mobile_image: uploadedIds.arch }]
            : []),
        ],
      },
      {
        __component: 'common.main-section',
        label: 'What differentiates VQ Capital Partners',
        name: 'Investors first. Fund managers later.',
        description:
          'VQ Capital Partners began by investing its own capital before managing capital for others. That origin continues to shape the investment practice: meaningful positions where conviction is strongest, time for the underlying value to compound, and continued alignment with clients.',
        button: {
          buttonText: 'Explore the investment philosophy',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/investment-philosophy',
        },
        grid_items: [
          {
            name: 'High concentration',
            description:
              'The strongest conclusions receive meaningful weight rather than being diluted across every available opportunity.',
          },
          {
            name: 'Long term',
            description:
              'Re-evaluating and maintaining our conviction through market cycles to capture the full value of a position.',
          },
          {
            name: 'Capital alignment',
            description:
              'The firm invests alongside clients, so risk and consequence remain part of the same conversation.',
          },
        ],
      },
      {
        __component: 'common.main-section',
        label: 'VQ Capital Partners as a platform',
        name: 'Research roots. Institutional scale.',
        description:
          'What began as an independent research practice has developed into a public markets and Private Equity investment platform serving individuals, family offices and institutions. VQ Capital Partners benefits from talent, a regulatory framework, and risk governance developed over decades.',
        button: {
          buttonText: 'About VQ Capital Partners',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/about-vq',
        },
        stat_items: [
          {
            stat: '$3.21B',
            name: 'Assets under management',
            description: 'Assets under management · As of 30 June 2026',
          },
          {
            stat: '16 years+',
            name: 'Managing external capital',
            description:
              'Managing external capital, built on research-house roots from the mid-1990s',
          },
          {
            stat: '$1B institutional capital',
            name: 'Institutional capital',
            description:
              'Institutional relationships sit alongside individual investors and family offices',
          },
        ],
      },
      {
        __component: 'common.main-section',
        label: 'VQ Capital Partners’ research process',
        name: 'Top-down perspective. Bottom-up precision.',
        description:
          'Top-down research defines the field of opportunity. Bottom-up research determines what deserves capital. Between the two sits a deliberate sequence that turns a broad observation into a specific decision.',
        button: {
          buttonText: 'Investment vehicles',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/investment-vehicles',
        },
      },
      {
        __component: 'common.insight-section',
        name: 'Insights',
        cards: [
          {
            label: 'Publications',
            label_value: '17 April 2026 · 4 min read',
            name: 'Patience is being tested. Conviction will be rewarded.',
            description:
              'A difficult market asks whether repricing has weakened the long-term case—or improved the opportunity for patient capital.',
            ...(uploadedIds.insight ? { image: uploadedIds.insight } : {}),
            buttons: [
              {
                buttonText: 'Read more',
                type: 'Internal',
                buttonType: 'Primary',
                buttonLink: '/field-note-07',
              },
              {
                buttonText: 'See all insights',
                type: 'Internal',
                buttonType: 'Secondary',
                buttonLink: '/insights',
              },
            ],
          },
          {
            label: 'Press coverage',
            label_value: 'The Economic Times · 18 February 2026',
            name: 'VQ Capital Partners raises ₹1,500 crore for advanced manufacturing growth.',
            description:
              'The Economic Times reports on VQ Capital Partners’ Private Equity fundraise and its focus on aerospace, defence and energy transition.',
            ...(uploadedIds.press ? { image: uploadedIds.press } : {}),
            buttons: [
              {
                buttonText: 'Read more',
                type: 'External',
                buttonType: 'Primary',
                buttonLink:
                  'https://economictimes.indiatimes.com/tech/funding/valuequest-raises-rs-2000-crore-from-domestic-lps-with-eye-on-advanced-manufacturing-growth/articleshow/128477199.cms',
              },
              {
                buttonText: 'See all news',
                type: 'Internal',
                buttonType: 'Secondary',
                buttonLink: '/in-the-news',
              },
            ],
          },
        ],
      },
      {
        __component: 'common.bottom-link',
        name: 'continue',
        button: {
          buttonText: 'Investment philosophy',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/investment-philosophy',
        },
      },
    ],
  };
}

async function run() {
  process.chdir(PROJECT_ROOT);
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-home-'));
  let app;

  try {
    if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist/config/database.js'))) {
      throw new Error('dist/ not built. Run `npm run build` first (or stop dev server if it is mid-compile).');
    }
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    const uploadService = app.plugin('upload').service('upload');
    const uploadedIds = {};
    const missingImages = [];

    for (const img of IMAGES) {
      const existing = await app.db.query('plugin::upload.file').findOne({ where: { name: img.name } });
      if (existing) {
        uploadedIds[img.key] = existing.id;
        console.log(`[seed-home] Media exists: ${img.name} (id=${existing.id})`);
      } else {
        missingImages.push(img);
      }
    }

    if (missingImages.length > 0) {
      const downloaded = await downloadImages(tempDir);
      for (const img of missingImages) {
        const fileInfo = downloaded[img.key];
        if (!fileInfo) continue;
        const [uploaded] = await uploadService.upload({
          data: { fileInfo: { name: fileInfo.name, alternativeText: fileInfo.name } },
          files: {
            filepath: fileInfo.filepath,
            originalFilename: fileInfo.name,
            mimetype: fileInfo.mime,
            size: fileInfo.size,
          },
        });
        uploadedIds[img.key] = uploaded.id;
        console.log(`[seed-home] Uploaded media: ${fileInfo.name} (id=${uploaded.id})`);
      }
    }

    const existingHome = await app.documents('api::home.home').findFirst({ status: 'published' });
    const homeData = buildHomeData(uploadedIds);

    if (existingHome && !FORCE) {
      console.log(
        `[seed-home] Home already published (documentId=${existingHome.documentId}). Pass --force to overwrite.`
      );
    } else if (existingHome && FORCE) {
      const updated = await app.documents('api::home.home').update({
        documentId: existingHome.documentId,
        data: homeData,
        status: 'published',
      });
      console.log(`[seed-home] Updated & published Home (documentId=${updated.documentId})`);
    } else {
      const created = await app.documents('api::home.home').create({
        data: homeData,
        status: 'published',
      });
      console.log(`[seed-home] Created & published Home (documentId=${created.documentId})`);
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const res = await syncJSON('api::home.home');
      console.log('[seed-home] JSON export:', res.status, res.message, res.fileName || '');
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
    console.error('[seed-home] Failed:', err);
    process.exit(1);
  });
