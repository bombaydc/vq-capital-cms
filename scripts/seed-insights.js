'use strict';

/**
 * Seed script for `api::insight-page.insight-page` (Single Type, Insights page),
 * `api::insight.insight` (Collection Type, 6 entries), and their Media Library assets.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-insights.js            # Upload missing media & seed missing entries
 *   node scripts/seed-insights.js --force    # Overwrite/update existing entries & publish
 *   node scripts/seed-insights.js --export   # Also export insight-page.json & insights.json
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

// Shown on the article pages whose full text is not published yet.
const DRAFT_BODY =
  '<h2>Full article coming soon.</h2>' +
  '<p>This insight is currently a draft. The complete article will be added once the editorial copy is approved.</p>';

const FIELD_NOTE_BODY = [
  'The environment is undeniably difficult. But discomfort alone does not determine the investment response. The more consequential question is whether present conditions weaken the long-term case—or offer reason to deepen conviction. Our view is the latter.',
  'A market can usually absorb one adverse variable. When several shocks arrive together, volatility becomes a broader repricing of risk. At the time of publication, the Nifty was approximately 15% lower. Beneath the index, the median peak-to-trough decline across BSE 500 constituents was around 30–36%, while several businesses followed closely by VQ Capital Partners had corrected by 40–50%.',
  'Periods such as this do not persist indefinitely. Previous episodes of comparable stress were ultimately followed by materially higher Indian equity markets. VQ Capital Partners regards the present configuration as an infrequent risk-reward opportunity for investors able to maintain a three-to-five-year horizon.',
  'Favourable news and favourable prices seldom arrive together. In April 2026, VQ Capital Partners’ assessment was that India offered both for patient capital: structural tailwinds remained intact, valuations had reset and entry levels had become more compelling. The test is patience. The source of that patience must remain conviction grounded in the underlying businesses.',
]
  .map((paragraph) => `<p>${paragraph}</p>`)
  .join('');

// Listed in the order they appear on the page.
const INSIGHTS = [
  {
    category: 'Publications',
    name: 'Patience is being tested. Conviction will be rewarded.',
    slug: 'field-note-07',
    path: '/field-note-07',
    label: '04A / Insights',
    label_value: '17 April 2026 · 4 min read',
    description:
      'A difficult market asks whether repricing has weakened the long-term case—or improved the opportunity for patient capital.',
    image: '/vq-insight-patience-v2.png',
    is_featured: true,
    author: 'VQ Capital Partners Investment Team',
    body: FIELD_NOTE_BODY,
    source: {
      text: 'Read the original article on VQ Capital Partners',
      link: 'https://www.valuequest.in/patience-is-being-tested-conviction-will-be-rewarded/',
    },
    disclaimer:
      'Market figures are presented as cited in the original publication and are not current market data or investment advice.',
  },
  {
    category: 'Research papers',
    name: 'When does a long-term trend become investable?',
    slug: 'when-a-trend-becomes-investable',
    label_value: 'Research case · 9 min read',
    description:
      'Solar existed for decades before manufacturing scale and falling costs converted scientific possibility into investable economics.',
    image: '/vq-pe-solar-hero-v2.png',
  },
  {
    category: 'Thought leadership',
    name: 'The ₹500 threshold that changed quick commerce.',
    slug: 'the-500-rupee-threshold',
    label_value: 'Field note · 6 min read',
    description:
      'The inflection was not technological. It appeared when behaviour and unit economics crossed the same threshold.',
    image: '/vq-pe-manufacturing-hero-v2.png',
  },
  {
    category: 'Publications',
    name: 'Conviction is not the refusal to change one’s mind.',
    slug: 'conviction-and-changing-ones-mind',
    label_value: 'Investment letter · 8 min read',
    description:
      'Patience should follow evidence. A decision record defines what must remain true—and what would disconfirm the thesis.',
    image: '/vq-insight-conviction-v2.png',
  },
  {
    category: 'Research papers',
    name: 'Mapping where value migrates next.',
    slug: 'mapping-value-migration',
    label_value: 'Research paper · 12 min read',
    description:
      'A framework for moving from structural change to maximum delta, industry structure and the businesses with a right to win.',
    image: '/vq-pe-aerospace-hero-v3.png',
  },
  {
    category: 'Thought leadership',
    name: 'What to observe before the headline.',
    slug: 'before-the-headline',
    label_value: 'Field note · 7 min read',
    description:
      'Lead indicators are often small facts: a cost curve, new capacity, a change in regulation or a behaviour becoming habit.',
    image: '/vq-principle-concentration-v4.png',
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
      console.warn(`[seed-insights] Failed to download ${fullUrl}: HTTP ${res.status}`);
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
    console.log(`[seed-insights] Uploaded ${fileName} -> id=${uploaded.id}`);
    return uploaded.id;
  } catch (err) {
    console.warn(`[seed-insights] Error uploading ${fullUrl}: ${err.message}`);
    return null;
  }
}

function buildPageData(socialId) {
  const social = (socialNetwork) => ({
    socialNetwork,
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    ...(socialId ? { image: socialId } : {}),
  });

  return {
    name: 'Insights',
    description:
      'Ideas should leave a trail. VQ Capital Partners’ Insights bring together research papers, publications and thought leadership—revealing the original question, the lead indicators, the competing evidence and the point at which a view changed.',
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
        name: 'Insights',
        type: 'insight-list',
      },
      {
        __component: 'common.bottom-link',
        name: 'continue',
        button: {
          buttonText: 'News & Events',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/in-the-news',
        },
      },
    ],
  };
}

function buildInsightData(insight, imageId) {
  return {
    name: insight.name,
    slug: insight.slug,
    category: insight.category,
    label: insight.label || `Insights / ${insight.category}`,
    label_value: insight.label_value,
    description: insight.description,
    is_featured: Boolean(insight.is_featured),
    ...(imageId ? { image: imageId } : {}),
    buttons: [
      {
        buttonText: 'Read more',
        type: 'Internal',
        buttonType: 'Primary',
        buttonLink: insight.path || `/perspectives/${insight.slug}`,
      },
    ],
    body: insight.body || DRAFT_BODY,
    ...(insight.author ? { author: insight.author } : {}),
    ...(insight.source
      ? {
          source_button: {
            buttonText: insight.source.text,
            type: 'External',
            buttonType: 'Secondary',
            buttonLink: insight.source.link,
          },
        }
      : {}),
    ...(insight.disclaimer ? { disclaimer: insight.disclaimer } : {}),
    seo: {
      metaTitle: `${insight.name} | VQ Capital Partners`,
      metaDescription: insight.description.slice(0, 160),
      ...(imageId ? { metaImage: imageId } : {}),
    },
  };
}

async function run() {
  process.chdir(PROJECT_ROOT);
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist/config/database.js'))) {
    throw new Error('dist/ not built. Run `npm run build` first.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-insights-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    // Seed the Insights single type
    const socialId = await ensureMedia(app, tempDir, SOCIAL_IMAGE_URL);
    const pageData = buildPageData(socialId);
    const page = await app.documents('api::insight-page.insight-page').findFirst();

    if (page && !FORCE) {
      console.log(`[seed-insights] Insight page exists (documentId=${page.documentId}). Pass --force to overwrite.`);
    } else if (page && FORCE) {
      await app.documents('api::insight-page.insight-page').update({
        documentId: page.documentId,
        data: pageData,
        status: 'published',
      });
      console.log(`[seed-insights] Updated & published Insight page (documentId=${page.documentId})`);
    } else {
      const created = await app.documents('api::insight-page.insight-page').create({
        data: pageData,
        status: 'published',
      });
      console.log(`[seed-insights] Created & published Insight page (documentId=${created.documentId})`);
    }

    // Seed insights in page order
    for (const insight of INSIGHTS) {
      const imageId = await ensureMedia(app, tempDir, insight.image);
      const insightData = buildInsightData(insight, imageId);

      const existing = await app.documents('api::insight.insight').findFirst({
        filters: { slug: { $eq: insight.slug } },
      });

      if (existing && !FORCE) {
        console.log(`[seed-insights] Insight exists: ${insight.slug}`);
      } else if (existing && FORCE) {
        await app.documents('api::insight.insight').update({
          documentId: existing.documentId,
          data: insightData,
          status: 'published',
        });
        console.log(`[seed-insights] Updated & published Insight: ${insight.slug}`);
      } else {
        await app.documents('api::insight.insight').create({
          data: insightData,
          status: 'published',
        });
        console.log(`[seed-insights] Created & published Insight: ${insight.slug}`);
      }
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const r1 = await syncJSON('api::insight-page.insight-page');
      console.log('[seed-insights] Export insight-page.json:', r1.status, r1.message);
      const r2 = await syncJSON('api::insight.insight');
      console.log('[seed-insights] Export insights.json:', r2.status, r2.message);
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
    console.error('[seed-insights] Failed:', err);
    process.exit(1);
  });
