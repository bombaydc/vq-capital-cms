'use strict';

/**
 * Seed script for `api::newsroom.newsroom` (Single Type, News & Events page),
 * `api::news-item.news-item` (Collection Type, 5 entries), and their Media Library assets.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-news.js            # Upload missing media & seed missing entries
 *   node scripts/seed-news.js --force    # Overwrite/update existing entries & publish
 *   node scripts/seed-news.js --export   # Also export newsroom.json & news-items.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SITE_ORIGIN = 'https://vqcapitalpartners.vercel.app';
const SOCIAL_IMAGE_URL = 'https://wondrous-sawine-0270e5.netlify.app/vq-social-preview.png';
const SOCIAL_TITLE = 'VQ Capital Partners — Independent investment thinking';
const SOCIAL_DESCRIPTION =
  'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.';
const FORCE = process.argv.includes('--force');
const EXPORT_JSON = process.argv.includes('--export');

// Listed in the order they appear on the page.
const NEWS_ITEMS = [
  {
    category: 'Press coverage',
    name: 'VQ Capital Partners raises ₹1,500 crore for advanced manufacturing growth.',
    slug: 'vq-capital-partners-raises-1500-crore-advanced-manufacturing-growth',
    label_value: 'The Economic Times · 18 February 2026',
    description:
      'The Economic Times reports on VQ Capital Partners’ Private Equity fundraise and its focus on aerospace, defence and energy transition.',
    image: '/vq-press-note-fundraise-portrait.png',
    is_featured: true,
    button: {
      text: 'Read more',
      type: 'External',
      link: 'https://economictimes.indiatimes.com/tech/funding/valuequest-raises-rs-2000-crore-from-domestic-lps-with-eye-on-advanced-manufacturing-growth/articleshow/128477199.cms',
    },
  },
  {
    category: 'Events',
    name: 'Vantage 2026: From geopolitics to growth.',
    slug: 'vantage-2026',
    label_value: 'April 2026 · Mumbai, India',
    description:
      'VQ Capital Partners’ annual Private Equity investor day brought together investors, founders and thinkers to examine sectors at an inflection point. Defence. Aerospace. Space. The conversations focused less on what had already happened—and more on what comes next.',
    image: '/moodboard/auditorium-empty.jpg',
    button: {
      text: 'See Vantage 2026',
      type: 'External',
      link: 'https://www.linkedin.com/posts/valuequest-investment-advisors_vantage-2026-valuequests-annual-private-activity-7454454654551154688-uHLs',
    },
  },
  {
    category: 'Events',
    name: 'Investor Day 2025: Three sectors. Multiple vantage points.',
    slug: 'investor-day-2025',
    label_value: '19 March 2025 · Mumbai, India',
    description:
      'The maiden Private Equity Investor Day examined energy transition, aerospace and defence, and technology-driven businesses through conversations with VQ Capital Partners’ investment leaders and the people building within those sectors.',
    image: '/moodboard/auditorium-empty.jpg',
    button: {
      text: 'View the 2025 programme',
      type: 'External',
      link: 'https://www.valuequest.in/investor-day-2025/',
    },
  },
  {
    category: 'Events',
    name: 'Perspectiv 2026: The global industrial capex supercycle.',
    slug: 'perspectiv-2026',
    label_value: 'July 2026 · Mumbai, India',
    description:
      'A public-markets gathering centred on how AI, geopolitics and industrial investment are reshaping the physical world—and the implications for India’s place within the cycle.',
    image: '/moodboard/refinery-carburos.jpg',
    button: { text: 'See event details', type: 'Internal', link: '/contact' },
  },
  {
    category: 'Events',
    name: 'Inflexion Day 2023: The earlier questions remain in the archive.',
    slug: 'inflexion-day-2023',
    label_value: '18 March 2023 · Mumbai, India',
    description:
      'An earlier investor gathering considered the art of identifying the right businesses at the right time. The value of an event is not only what was said on the day, but what can later be tested against outcomes.',
    image: '/moodboard/auditorium-empty.jpg',
    button: {
      text: 'Open the archived agenda',
      type: 'External',
      link: 'https://valuequest.in/wp-content/themes/value-quest/images/inflexion/VQ_InflexionDay_Agenda.pdf',
    },
  },
];

const MIME_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// Media is matched by file name, so images already uploaded by other seeds are reused.
async function ensureMedia(app, tempDir, urlPath) {
  if (!urlPath) return null;
  const fullUrl = urlPath.startsWith('http') ? urlPath : `${SITE_ORIGIN}${urlPath}`;
  const fileName = path.basename(urlPath);

  const existing = await app.db.query('plugin::upload.file').findOne({ where: { name: fileName } });
  if (existing) {
    return existing.id;
  }

  try {
    const res = await fetch(fullUrl);
    if (!res.ok) {
      console.warn(`[seed-news] Failed to download ${fullUrl}: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(tempDir, fileName);
    fs.writeFileSync(dest, buf);

    const [uploaded] = await app.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: fileName, alternativeText: fileName } },
      files: {
        filepath: dest,
        originalFilename: fileName,
        mimetype: MIME_TYPES[path.extname(fileName).toLowerCase()],
        size: buf.length,
      },
    });
    console.log(`[seed-news] Uploaded ${fileName} -> id=${uploaded.id}`);
    return uploaded.id;
  } catch (err) {
    console.warn(`[seed-news] Error uploading ${fullUrl}: ${err.message}`);
    return null;
  }
}

function buildNewsroomData(socialId) {
  const social = (socialNetwork) => ({
    socialNetwork,
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    ...(socialId ? { image: socialId } : {}),
  });

  return {
    label: 'Updates',
    name: 'News & Events',
    description: 'News, press coverage and events from across VQ Capital Partners.',
    seo: {
      metaTitle: SOCIAL_TITLE,
      metaDescription: SOCIAL_DESCRIPTION,
      metaRobots: 'noindex, nofollow',
      metaViewport: 'width=device-width, initial-scale=1',
      ...(socialId ? { metaImage: socialId } : {}),
      metaSocial: [social('Facebook'), social('Twitter')],
    },
    content: [
      {
        __component: 'common.dynamic-section',
        name: 'News & Events',
        type: 'news-list',
      },
      {
        __component: 'common.bottom-link',
        name: 'continue',
        button: {
          buttonText: 'About VQ Capital Partners',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/about-vq',
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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-news-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    // Seed the News & Events single type
    const socialId = await ensureMedia(app, tempDir, SOCIAL_IMAGE_URL);
    const newsroomData = buildNewsroomData(socialId);
    const newsroom = await app.documents('api::newsroom.newsroom').findFirst();

    if (newsroom && !FORCE) {
      console.log(`[seed-news] Newsroom exists (documentId=${newsroom.documentId}). Pass --force to overwrite.`);
    } else if (newsroom && FORCE) {
      await app.documents('api::newsroom.newsroom').update({
        documentId: newsroom.documentId,
        data: newsroomData,
        status: 'published',
      });
      console.log(`[seed-news] Updated & published Newsroom (documentId=${newsroom.documentId})`);
    } else {
      const created = await app.documents('api::newsroom.newsroom').create({
        data: newsroomData,
        status: 'published',
      });
      console.log(`[seed-news] Created & published Newsroom (documentId=${created.documentId})`);
    }

    // Seed news items in page order
    for (const item of NEWS_ITEMS) {
      const imageId = await ensureMedia(app, tempDir, item.image);

      const itemData = {
        name: item.name,
        slug: item.slug,
        category: item.category,
        label_value: item.label_value,
        description: item.description,
        is_featured: Boolean(item.is_featured),
        ...(imageId ? { image: imageId } : {}),
        buttons: [
          {
            buttonText: item.button.text,
            type: item.button.type,
            buttonType: 'Primary',
            buttonLink: item.button.link,
          },
        ],
        seo: {
          metaTitle: `${item.name} | VQ Capital Partners`,
          metaDescription: item.description.slice(0, 160),
          ...(imageId ? { metaImage: imageId } : {}),
        },
      };

      const existing = await app.documents('api::news-item.news-item').findFirst({
        filters: { slug: { $eq: item.slug } },
      });

      if (existing && !FORCE) {
        console.log(`[seed-news] News item exists: ${item.slug}`);
      } else if (existing && FORCE) {
        await app.documents('api::news-item.news-item').update({
          documentId: existing.documentId,
          data: itemData,
          status: 'published',
        });
        console.log(`[seed-news] Updated & published News item: ${item.slug}`);
      } else {
        await app.documents('api::news-item.news-item').create({
          data: itemData,
          status: 'published',
        });
        console.log(`[seed-news] Created & published News item: ${item.slug}`);
      }
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const r1 = await syncJSON('api::newsroom.newsroom');
      console.log('[seed-news] Export newsroom.json:', r1.status, r1.message);
      const r2 = await syncJSON('api::news-item.news-item');
      console.log('[seed-news] Export news-items.json:', r2.status, r2.message);
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
    console.error('[seed-news] Failed:', err);
    process.exit(1);
  });
