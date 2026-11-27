'use strict';

/**
 * Seed script for `api::investment-philosophy.investment-philosophy` (Single Type) + Media Library assets.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-investment-philosophy.js            # Create & publish if empty
 *   node scripts/seed-investment-philosophy.js --force    # Overwrite/update & publish
 *   node scripts/seed-investment-philosophy.js --export   # Also export public/uploads/data/investment-philosophy.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');
const EXPORT_JSON = process.argv.includes('--export');

const IMAGES = [
  {
    key: 'quote',
    url: 'https://vqcapitalpartners.vercel.app/moodboard/investment-philosophy-quote-market-trends.png',
    name: 'investment-philosophy-quote-market-trends.png',
    mime: 'image/png',
    alt: 'Hand pointing at company performance charts on a market dashboard',
  },
  {
    key: 'radar',
    url: 'https://vqcapitalpartners.vercel.app/moodboard/defence-case-study-radar.webp',
    name: 'defence-case-study-radar.webp',
    mime: 'image/webp',
    alt: 'Aerial view of a large antenna dish surrounded by forest at dusk',
  },
  {
    key: 'social',
    url: 'https://wondrous-sawine-0270e5.netlify.app/vq-social-preview.png',
    name: 'vq-social-preview.png',
    mime: 'image/png',
    alt: 'vq-social-preview.png',
  },
];

async function ensureMedia(app, uploadService, tempDir, img) {
  const existing = await app.db.query('plugin::upload.file').findOne({ where: { name: img.name } });
  if (existing) return existing.id;

  try {
    const res = await fetch(img.url);
    if (!res.ok) {
      console.warn(`[seed-investment-philosophy] Failed to download ${img.url}: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(tempDir, img.name);
    fs.writeFileSync(dest, buf);

    const [uploaded] = await uploadService.upload({
      data: { fileInfo: { name: img.name, alternativeText: img.alt || img.name } },
      files: {
        filepath: dest,
        originalFilename: img.name,
        mimetype: img.mime,
        size: buf.length,
      },
    });
    console.log(`[seed-investment-philosophy] Uploaded ${img.name} -> id=${uploaded.id}`);
    return uploaded.id;
  } catch (err) {
    console.warn(`[seed-investment-philosophy] Error uploading ${img.url}: ${err.message}`);
    return null;
  }
}

function buildData(ids) {
  return {
    label: 'Investment philosophy',
    name: 'Conviction before consensus.',
    description:
      'We identify transformational businesses before they become obvious, through independent research, structural thinking and disciplined execution.',
    seo: {
      metaTitle: 'VQ Capital Partners — Independent investment thinking',
      metaDescription:
        'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
      metaRobots: 'noindex, nofollow',
      metaViewport: 'width=device-width, initial-scale=1',
      ...(ids.social ? { metaImage: ids.social } : {}),
      metaSocial: [
        {
          socialNetwork: 'Facebook',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(ids.social ? { image: ids.social } : {}),
        },
        {
          socialNetwork: 'Twitter',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(ids.social ? { image: ids.social } : {}),
        },
      ],
    },
    content: [
      {
        __component: 'common.quote-section',
        quote:
          'Identifying that inflection point in a mega trend, and identifying the companies that are best positioned to ride that trend.',
        author: null,
        ...(ids.quote ? { desktop_image: ids.quote, mobile_image: ids.quote } : {}),
      },
      {
        __component: 'common.steps-section',
        label: 'The approach',
        name: 'Investors in principal, not money managers.',
        description:
          'We aim for absolute returns on our corpus, not benchmark relativity. We have skin in the game and we invest for the long term. So our money and interests are aligned with those of our investors.',
        items: [
          {
            name: 'Identify inflection points in sectors.',
            description:
              'Extraordinary wealth is created when large structural themes reshape industries, shift profit pools and create winners. These transitions take a sector from experimental to scalable, from niche to mainstream. We aim to identify them before they show up in reported numbers or become widely accepted by the market.',
          },
          {
            name: 'Back a few, not the many.',
            description:
              'Identifying the right theme is not enough. Value accrues in a few exceptional companies. Those in large and expanding opportunity pools with scalable models, and durable competitive advantages. We seek the right company, at the right stage of its evolution, at a valuation that offers attractive long-term risk-reward.',
          },
          {
            name: 'Act with conviction.',
            description:
              'When the research is complete and the opportunity is clear, we deploy capital decisively and in meaningful size. Conviction earned through rigour is what allows us to move when others hesitate.',
          },
          {
            name: 'Hold as long as the thesis holds.',
            description:
              'We assess every opportunity through a rolling 3–5 year lens. Positions stay while the trend is intact and the business keeps compounding. Exits are triggered by fundamentals and valuation discipline, never by market emotion.',
          },
          {
            name: 'Avoid what may impair capital.',
            description:
              'We protect downside before chasing upside. Binary outcomes, corporate leverage and weak governance are excluded before they are ever evaluated. Stringent quality screening and a strict margin of safety come first.',
          },
        ],
      },
      {
        __component: 'common.rich-text-section',
        label: 'The process',
        name: 'A dual lens view of opportunity.',
        description:
          '<p>Our approach is thematic yet fundamentally still bottom-up. Top-down, we identify multi-year megatrends before consensus and map sectors and business models most likely to create and retain value. Bottom-up, we find the specific companies with the right to win by evaluating leaders, challengers and disruptors.</p>',
        rich_items: [
          {
            name: 'Identifying picks and shovels.',
            description:
              '<p>We continuously track technology curves, cost curves, regulatory and behavioural shifts to tell us when a megatrend has moved from watchlist to investible. We then map its value chain to find the <a href="/picks-and-shovels-economics">picks and shovels</a>: the sectors and business models that will create and retain the most value.</p>',
          },
          {
            name: 'Passing the SCALE test.',
            description:
              '<p>We assess each business for <a href="/scale-framework">SCALE</a> — scalability, competitive advantage, adaptability, long runway and superior execution. This filters a universe of 700 to 800 companies to 15 to 25 high-conviction ideas. Each passes through defined research and investment gates before capital is allocated.</p>',
          },
          {
            name: 'Earning the right to remain.',
            description:
              '<p>After investing, every thesis is tested continuously against operating milestones and changing evidence. Portfolios are rebalanced systematically and risk is managed proactively. Every company must keep earning its place consistently in our portfolio.</p>',
          },
        ],
      },
      {
        __component: 'common.media-section',
        label: 'Case studies',
        name: 'Defence: from radar to investible.',
        description:
          'VQ Capital Partners began tracking Indian defence in 2015. Strategic importance alone did not justify capital: the sector still carried uncertain timelines, weak working-capital economics and execution risk. The investment conclusion changed only when policy, budgets and procurement reform altered both probability and economic value.',
        ...(ids.radar ? { desktop_image: ids.radar, mobile_image: ids.radar } : {}),
        items: [
          {
            name: '2015 — On the radar',
            description:
              'Make in India made the sector structurally significant, but the evidence was not yet sufficient for investment.',
          },
          {
            name: 'The inflection',
            description:
              'Domestic-procurement priority, progressive import bans and shorter payment cycles changed the industry’s growth, return and cash-flow profile.',
          },
          {
            name: 'Where value would move',
            description:
              'Budget allocation and the capability gap directed the work toward Navy and Air Force equipment rather than the sector in aggregate.',
          },
          {
            name: 'Capital after evidence',
            description:
              'Deployment followed only after the inflection, industry structure and company-level right to win had been established.',
          },
        ],
        button: {
          buttonText: 'View all case studies',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/case-studies',
        },
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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-philosophy-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();
    const uploadService = app.plugin('upload').service('upload');

    const ids = {};
    for (const img of IMAGES) {
      ids[img.key] = await ensureMedia(app, uploadService, tempDir, img);
    }

    const data = buildData(ids);
    const existing = await app
      .documents('api::investment-philosophy.investment-philosophy')
      .findFirst({ status: 'published' });

    if (existing && !FORCE) {
      console.log(
        `[seed-investment-philosophy] Already published (documentId=${existing.documentId}). Pass --force to overwrite.`
      );
    } else if (existing && FORCE) {
      const updated = await app
        .documents('api::investment-philosophy.investment-philosophy')
        .update({
          documentId: existing.documentId,
          data,
          status: 'published',
        });
      console.log(`[seed-investment-philosophy] Updated & published (documentId=${updated.documentId})`);
    } else {
      const created = await app
        .documents('api::investment-philosophy.investment-philosophy')
        .create({
          data,
          status: 'published',
        });
      console.log(`[seed-investment-philosophy] Created & published (documentId=${created.documentId})`);
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const res = await syncJSON('api::investment-philosophy.investment-philosophy');
      console.log('[seed-investment-philosophy] Export JSON:', res.status, res.message);
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
    console.error('[seed-investment-philosophy] Failed:', err);
    process.exit(1);
  });
